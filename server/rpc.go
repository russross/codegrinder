package main

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/russross/codegrinder/rpc"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// codeGrinderServiceServer implements the CodeGrinderServiceServer interface
type codeGrinderServiceServer struct {
	pb.UnimplementedCodeGrinderServiceServer
}

// withTXForGRPC is a wrapper for gRPC handlers to run in a database transaction
func withTXForGRPC(ctx context.Context, fn func(tx *sql.Tx) error) error {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	start := time.Now()
	defer func() {
		elapsed := time.Since(start)
		if elapsed > 500*time.Millisecond {
			switch {
			case elapsed < time.Second:
				elapsed -= elapsed % time.Millisecond
			case elapsed < 10*time.Second:
				elapsed -= elapsed % (10 * time.Millisecond)
			default:
				elapsed -= elapsed % (100 * time.Millisecond)
			}
			log.Printf("transaction took %v", elapsed)
		}
	}()

	tx, err := db.Begin()
	if err != nil {
		return status.Errorf(codes.Internal, "db error starting transaction: %v", err)
	}

	// Execute the function
	err = fn(tx)
	if err != nil {
		if rollbackErr := tx.Rollback(); rollbackErr != nil {
			log.Printf("db error rolling back transaction: %v", rollbackErr)
		}
		return err
	}

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		return status.Errorf(codes.Internal, "db error committing transaction: %v", err)
	}
	return nil
}

// getSessionFromGRPC extracts and validates the session cookie from gRPC metadata
func getSessionFromGRPC(ctx context.Context) (*CookieSession, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "missing metadata")
	}

	cookies := md.Get("cookie")
	if len(cookies) == 0 {
		return nil, status.Error(codes.Unauthenticated, "missing session cookie")
	}

	// Find the codegrinder cookie
	var cookieValue string
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie, CookieName+"=") {
			cookieValue = strings.TrimPrefix(cookie, CookieName+"=")
			break
		}
	}
	if cookieValue == "" {
		return nil, status.Error(codes.Unauthenticated, "missing session cookie")
	}

	return DecodeSession(cookieValue)
}

// getCurrentUserFromSession loads the current user from the database using meddler
func getCurrentUserFromSession(tx *sql.Tx, session *CookieSession) (*User, error) {
	currentUser := new(User)
	if err := meddler.Load(tx, "users", currentUser, session.UserID); err != nil {
		return nil, status.Errorf(codes.Internal, "db error loading user: %v", err)
	}
	return currentUser, nil
}

// ListProblems retrieves all problems and related data for the authenticated user
func (s *codeGrinderServiceServer) ListProblems(ctx context.Context, req *pb.ListProblemsRequest) (*pb.ListProblemsResponse, error) {
	// Validate session
	session, err := getSessionFromGRPC(ctx)
	if err != nil {
		return nil, err
	}

	// Gather all data in a single transaction
	var user *pb.User
	var typeAssignments []*Assignment
	var courses []*pb.Course
	var problemSets []*pb.ProblemSet

	err = withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get user
		user = convertUserToProto(currentUser)

		// Get assignments
		typeAssignments, err = getUserAssignments(tx, session.UserID, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignments: %v", err)
		}

		// Get courses and problem sets
		courseMap := make(map[int64]*pb.Course)
		problemSetMap := make(map[int64]*pb.ProblemSet)
		for _, asst := range typeAssignments {
			// Get course if not already fetched
			if _, exists := courseMap[asst.CourseID]; !exists {
				course, err := getCourse(tx, asst.CourseID, currentUser)
				if err != nil {
					return status.Errorf(codes.Internal, "db error getting course: %v", err)
				}
				courseMap[asst.CourseID] = convertCourseToProto(course)
			}

			// Get problem set if not already fetched
			if _, exists := problemSetMap[asst.ProblemSetID]; !exists {
				problemSet, err := getProblemSet(tx, asst.ProblemSetID, currentUser)
				if err != nil {
					return status.Errorf(codes.Internal, "db error getting problem set: %v", err)
				}
				problemSetMap[asst.ProblemSetID] = convertProblemSetToProto(problemSet)
			}
		}

		// Convert to slices
		for _, c := range courseMap {
			courses = append(courses, c)
		}
		for _, ps := range problemSetMap {
			problemSets = append(problemSets, ps)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert assignments to proto
	var protoAssignments []*pb.Assignment
	for _, asst := range typeAssignments {
		protoAssignments = append(protoAssignments, convertAssignmentToProto(asst))
	}

	return &pb.ListProblemsResponse{
		User:        user,
		Assignments: protoAssignments,
		Courses:     courses,
		ProblemSets: problemSets,
	}, nil
}

// Helper functions to convert types to proto
func convertUserToProto(u *User) *pb.User {
	return &pb.User{
		Id:             u.ID,
		Name:           u.Name,
		Email:          u.Email,
		LtiId:          u.LtiID,
		ImageUrl:       u.ImageURL,
		CanvasLogin:    u.CanvasLogin,
		CanvasId:       u.CanvasID,
		Author:         u.Author,
		Admin:          u.Admin,
		CreatedAt:      convertTimeToProto(u.CreatedAt),
		UpdatedAt:      convertTimeToProto(u.UpdatedAt),
		LastSignedInAt: convertTimeToProto(u.LastSignedInAt),
	}
}

func convertCourseToProto(c *Course) *pb.Course {
	return &pb.Course{
		Id:        c.ID,
		Name:      c.Name,
		Label:     c.Label,
		LtiId:     c.LtiID,
		CanvasId:  c.CanvasID,
		CreatedAt: convertTimeToProto(c.CreatedAt),
		UpdatedAt: convertTimeToProto(c.UpdatedAt),
	}
}

func convertAssignmentToProto(a *Assignment) *pb.Assignment {
	rawScores := make(map[string]*pb.ScoreList)
	for k, v := range a.RawScores {
		rawScores[k] = &pb.ScoreList{Scores: v}
	}

	var unlockAt, dueAt, lockAt *time.Time
	unlockAt = a.UnlockAt
	dueAt = a.DueAt
	lockAt = a.LockAt

	return &pb.Assignment{
		Id:                 a.ID,
		CourseId:           a.CourseID,
		ProblemSetId:       a.ProblemSetID,
		UserId:             a.UserID,
		Roles:              a.Roles,
		Instructor:         a.Instructor,
		RawScores:          rawScores,
		Score:              a.Score,
		GradeId:            a.GradeID,
		LtiId:              a.LtiID,
		CanvasTitle:        a.CanvasTitle,
		CanvasId:           a.CanvasID,
		CanvasApiDomain:    a.CanvasAPIDomain,
		OutcomeUrl:         a.OutcomeURL,
		OutcomeExtUrl:      a.OutcomeExtURL,
		OutcomeExtAccepted: a.OutcomeExtAccepted,
		FinishedUrl:        a.FinishedURL,
		ConsumerKey:        a.ConsumerKey,
		UnlockAt:           convertTimeToProtoPtr(unlockAt),
		DueAt:              convertTimeToProtoPtr(dueAt),
		LockAt:             convertTimeToProtoPtr(lockAt),
		CreatedAt:          convertTimeToProto(a.CreatedAt),
		UpdatedAt:          convertTimeToProto(a.UpdatedAt),
	}
}

func convertProblemSetToProto(ps *ProblemSet) *pb.ProblemSet {
	return &pb.ProblemSet{
		Id:        ps.ID,
		Unique:    ps.Unique,
		Note:      ps.Note,
		Tags:      ps.Tags,
		CreatedAt: convertTimeToProto(ps.CreatedAt),
		UpdatedAt: convertTimeToProto(ps.UpdatedAt),
	}
}

func convertTimeToProto(t time.Time) *timestamppb.Timestamp {
	return timestamppb.New(t)
}

func convertTimeToProtoPtr(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

// Conversion functions for new types
func convertProblemTypeToProto(pt *ProblemType) *pb.ProblemType {
	actions := make(map[string]*pb.ProblemTypeAction)
	for k, v := range pt.Actions {
		actions[k] = &pb.ProblemTypeAction{
			ProblemType: v.ProblemType,
			Action:      v.Action,
			Command:     v.Command,
			Parser:      v.Parser,
			Message:     v.Message,
			Interactive: v.Interactive,
			MaxCpu:      v.MaxCPU,
			MaxSession:  v.MaxSession,
			MaxTimeout:  v.MaxTimeout,
			MaxFd:       v.MaxFD,
			MaxFileSize: v.MaxFileSize,
			MaxMemory:   v.MaxMemory,
			MaxThreads:  v.MaxThreads,
		}
	}
	return &pb.ProblemType{
		Name:    pt.Name,
		Image:   pt.Image,
		Files:   pt.Files,
		Actions: actions,
	}
}

func convertProblemToProto(p *Problem) *pb.Problem {
	return &pb.Problem{
		Id:        p.ID,
		Unique:    p.Unique,
		Note:      p.Note,
		Tags:      p.Tags,
		Options:   p.Options,
		CreatedAt: convertTimeToProto(p.CreatedAt),
		UpdatedAt: convertTimeToProto(p.UpdatedAt),
	}
}

func convertProblemStepToProto(ps *ProblemStep) *pb.ProblemStep {
	return &pb.ProblemStep{
		ProblemId:    ps.ProblemID,
		Step:         ps.Step,
		ProblemType:  ps.ProblemType,
		Note:         ps.Note,
		Instructions: ps.Instructions,
		Weight:       ps.Weight,
		Files:        ps.Files,
		Whitelist:    ps.Whitelist,
		Solution:     ps.Solution,
	}
}

func convertProblemSetProblemToProto(psp *ProblemSetProblem) *pb.ProblemSetProblem {
	return &pb.ProblemSetProblem{
		ProblemSetId: psp.ProblemSetID,
		ProblemId:    psp.ProblemID,
		Weight:       psp.Weight,
	}
}

func convertReportCardToProto(rc *ReportCard) *pb.ReportCard {
	results := make([]*pb.ReportCardResult, len(rc.Results))
	for i, r := range rc.Results {
		results[i] = &pb.ReportCardResult{
			Name:    r.Name,
			Outcome: r.Outcome,
			Details: r.Details,
			Context: r.Context,
		}
	}
	return &pb.ReportCard{
		Passed:   rc.Passed,
		Note:     rc.Note,
		Duration: durationpb.New(rc.Duration),
		Results:  results,
	}
}

func convertEventMessageToProto(em *EventMessage) *pb.EventMessage {
	return &pb.EventMessage{
		Time:        convertTimeToProto(em.Time),
		Event:       em.Event,
		ExecCommand: em.ExecCommand,
		ExitStatus:  int32(em.ExitStatus),
		StreamData:  em.StreamData,
		Error:       em.Error,
		ReportCard:  convertReportCardToProto(em.ReportCard),
		Files:       em.Files,
	}
}

func convertCommitToProto(c *Commit) *pb.Commit {
	transcript := make([]*pb.EventMessage, len(c.Transcript))
	for i, t := range c.Transcript {
		transcript[i] = convertEventMessageToProto(t)
	}
	return &pb.Commit{
		Id:           c.ID,
		AssignmentId: c.AssignmentID,
		ProblemId:    c.ProblemID,
		Step:         c.Step,
		Action:       c.Action,
		Note:         c.Note,
		Files:        c.Files,
		Transcript:   transcript,
		ReportCard:   convertReportCardToProto(c.ReportCard),
		Score:        c.Score,
		CreatedAt:    convertTimeToProto(c.CreatedAt),
		UpdatedAt:    convertTimeToProto(c.UpdatedAt),
	}
}

func convertProblemBundleFromProto(pb *pb.ProblemBundle) *ProblemBundle {
	problemTypes := make(map[string]*ProblemType)
	for k, v := range pb.ProblemTypes {
		problemTypes[k] = convertProblemTypeFromProto(v)
	}
	commits := make([]*Commit, len(pb.Commits))
	for i, c := range pb.Commits {
		commits[i] = convertCommitFromProto(c)
	}
	return &ProblemBundle{
		ProblemTypes:          problemTypes,
		ProblemTypeSignatures: pb.ProblemTypeSignatures,
		Problem:               convertProblemFromProto(pb.Problem),
		ProblemSteps:          convertProblemStepsFromProto(pb.ProblemSteps),
		ProblemSignature:      pb.ProblemSignature,
		Hostname:              pb.Hostname,
		UserID:                pb.UserId,
		Commits:               commits,
		CommitSignatures:      pb.CommitSignatures,
	}
}

func convertProblemTypeFromProto(pt *pb.ProblemType) *ProblemType {
	actions := make(map[string]*ProblemTypeAction)
	for k, v := range pt.Actions {
		actions[k] = &ProblemTypeAction{
			ProblemType: v.ProblemType,
			Action:      v.Action,
			Command:     v.Command,
			Parser:      v.Parser,
			Message:     v.Message,
			Interactive: v.Interactive,
			MaxCPU:      v.MaxCpu,
			MaxSession:  v.MaxSession,
			MaxTimeout:  v.MaxTimeout,
			MaxFD:       v.MaxFd,
			MaxFileSize: v.MaxFileSize,
			MaxMemory:   v.MaxMemory,
			MaxThreads:  v.MaxThreads,
		}
	}
	return &ProblemType{
		Name:    pt.Name,
		Image:   pt.Image,
		Files:   pt.Files,
		Actions: actions,
	}
}

func convertProblemFromProto(p *pb.Problem) *Problem {
	return &Problem{
		ID:        p.Id,
		Unique:    p.Unique,
		Note:      p.Note,
		Tags:      p.Tags,
		Options:   p.Options,
		CreatedAt: p.CreatedAt.AsTime(),
		UpdatedAt: p.UpdatedAt.AsTime(),
	}
}

func convertProblemStepsFromProto(pss []*pb.ProblemStep) []*ProblemStep {
	steps := make([]*ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = convertProblemStepFromProto(ps)
	}
	return steps
}

func convertProblemStepFromProto(ps *pb.ProblemStep) *ProblemStep {
	return &ProblemStep{
		ProblemID:    ps.ProblemId,
		Step:         ps.Step,
		ProblemType:  ps.ProblemType,
		Note:         ps.Note,
		Instructions: ps.Instructions,
		Weight:       ps.Weight,
		Files:        ps.Files,
		Whitelist:    ps.Whitelist,
		Solution:     ps.Solution,
	}
}

func convertCommitFromProto(c *pb.Commit) *Commit {
	transcript := make([]*EventMessage, len(c.Transcript))
	for i, t := range c.Transcript {
		transcript[i] = convertEventMessageFromProto(t)
	}
	return &Commit{
		ID:           c.Id,
		AssignmentID: c.AssignmentId,
		ProblemID:    c.ProblemId,
		Step:         c.Step,
		Action:       c.Action,
		Note:         c.Note,
		Files:        c.Files,
		Transcript:   transcript,
		ReportCard:   convertReportCardFromProto(c.ReportCard),
		Score:        c.Score,
		CreatedAt:    c.CreatedAt.AsTime(),
		UpdatedAt:    c.UpdatedAt.AsTime(),
	}
}

func convertEventMessageFromProto(em *pb.EventMessage) *EventMessage {
	return &EventMessage{
		Time:        em.Time.AsTime(),
		Event:       em.Event,
		ExecCommand: em.ExecCommand,
		ExitStatus:  int(em.ExitStatus),
		StreamData:  em.StreamData,
		Error:       em.Error,
		ReportCard:  convertReportCardFromProto(em.ReportCard),
		Files:       em.Files,
	}
}

func convertReportCardFromProto(rc *pb.ReportCard) *ReportCard {
	if rc == nil {
		return nil
	}
	results := make([]*ReportCardResult, len(rc.Results))
	for i, r := range rc.Results {
		results[i] = &ReportCardResult{
			Name:    r.Name,
			Outcome: r.Outcome,
			Details: r.Details,
			Context: r.Context,
		}
	}
	duration := time.Duration(0)
	if rc.Duration != nil {
		duration = rc.Duration.AsDuration()
	}
	return &ReportCard{
		Passed:   rc.Passed,
		Note:     rc.Note,
		Duration: duration,
		Results:  results,
	}
}

func convertProblemSetBundleFromProto(psb *pb.ProblemSetBundle) *ProblemSetBundle {
	return &ProblemSetBundle{
		ProblemSet:         convertProblemSetFromProto(psb.ProblemSet),
		ProblemSetProblems: convertProblemSetProblemsFromProto(psb.ProblemSetProblems),
	}
}

func convertProblemSetFromProto(ps *pb.ProblemSet) *ProblemSet {
	return &ProblemSet{
		ID:        ps.Id,
		Unique:    ps.Unique,
		Note:      ps.Note,
		Tags:      ps.Tags,
		CreatedAt: ps.CreatedAt.AsTime(),
		UpdatedAt: ps.UpdatedAt.AsTime(),
	}
}

func convertProblemSetProblemsFromProto(psps []*pb.ProblemSetProblem) []*ProblemSetProblem {
	problems := make([]*ProblemSetProblem, len(psps))
	for i, psp := range psps {
		problems[i] = &ProblemSetProblem{
			ProblemSetID: psp.ProblemSetId,
			ProblemID:    psp.ProblemId,
			Weight:       psp.Weight,
		}
	}
	return problems
}

func convertCommitBundleFromProto(cb *pb.CommitBundle) *CommitBundle {
	return &CommitBundle{
		ProblemType:          convertProblemTypeFromProto(cb.ProblemType),
		ProblemTypeSignature: cb.ProblemTypeSignature,
		Problem:              convertProblemFromProto(cb.Problem),
		ProblemSteps:         convertProblemStepsFromProto(cb.ProblemSteps),
		ProblemSignature:     cb.ProblemSignature,
		Action:               cb.Action,
		Hostname:             cb.Hostname,
		UserID:               cb.UserId,
		Commit:               convertCommitFromProto(cb.Commit),
		CommitSignature:      cb.CommitSignature,
	}
}

// convertDaycareRequestFromProto converts pb.DaycareRequest to legacy types recursively
func convertDaycareRequestFromProto(req *pb.DaycareRequest) (*CommitBundle, string, string, []string, error) {
	commitBundle := convertCommitBundleFromProto(req.CommitBundle)
	problemType := req.ProblemType
	action := req.Action
	args := req.Args
	return commitBundle, problemType, action, args, nil
}

// convertDaycareResponseToProto converts legacy DaycareResponse to pb.DaycareResponse
func convertDaycareResponseToProto(resp *DaycareResponse) *pb.DaycareResponse {
	pbResp := &pb.DaycareResponse{}
	if resp.Event != nil {
		pbResp.Response = &pb.DaycareResponse_Event{Event: convertEventMessageToProto(resp.Event)}
	} else if resp.Error != "" {
		pbResp.Response = &pb.DaycareResponse_Error{Error: resp.Error}
	} else if resp.CommitBundle != nil {
		pbResp.Response = &pb.DaycareResponse_CommitBundle{CommitBundle: convertCommitBundleToProto(resp.CommitBundle)}
	}
	return pbResp
}

// convertProblemStepsToProto converts legacy ProblemSteps to pb.ProblemSteps
func convertProblemStepsToProto(pss []*ProblemStep) []*pb.ProblemStep {
	steps := make([]*pb.ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = convertProblemStepToProto(ps)
	}
	return steps
}

// convertCommitBundleToProto converts legacy CommitBundle to pb.CommitBundle recursively
func convertCommitBundleToProto(cb *CommitBundle) *pb.CommitBundle {
	return &pb.CommitBundle{
		ProblemType:          convertProblemTypeToProto(cb.ProblemType),
		ProblemTypeSignature: cb.ProblemTypeSignature,
		Problem:              convertProblemToProto(cb.Problem),
		ProblemSteps:         convertProblemStepsToProto(cb.ProblemSteps),
		ProblemSignature:     cb.ProblemSignature,
		Action:               cb.Action,
		Hostname:             cb.Hostname,
		UserId:               cb.UserID,
		Commit:               convertCommitToProto(cb.Commit),
		CommitSignature:      cb.CommitSignature,
	}
}

// convertProblemBundleToProto converts legacy ProblemBundle to pb.ProblemBundle recursively
func convertProblemBundleToProto(bundle *ProblemBundle) *pb.ProblemBundle {
	problemTypes := make(map[string]*pb.ProblemType)
	for k, v := range bundle.ProblemTypes {
		problemTypes[k] = convertProblemTypeToProto(v)
	}
	commits := make([]*pb.Commit, len(bundle.Commits))
	for i, c := range bundle.Commits {
		commits[i] = convertCommitToProto(c)
	}
	return &pb.ProblemBundle{
		ProblemTypes:          problemTypes,
		ProblemTypeSignatures: bundle.ProblemTypeSignatures,
		Problem:               convertProblemToProto(bundle.Problem),
		ProblemSteps:          convertProblemStepsToProto(bundle.ProblemSteps),
		ProblemSignature:      bundle.ProblemSignature,
		Hostname:              bundle.Hostname,
		UserId:                bundle.UserID,
		Commits:               commits,
		CommitSignatures:      bundle.CommitSignatures,
	}
}

// convertProblemSetProblemsToProto converts legacy ProblemSetProblems to pb.ProblemSetProblems
func convertProblemSetProblemsToProto(psps []*ProblemSetProblem) []*pb.ProblemSetProblem {
	problems := make([]*pb.ProblemSetProblem, len(psps))
	for i, psp := range psps {
		problems[i] = &pb.ProblemSetProblem{
			ProblemSetId: psp.ProblemSetID,
			ProblemId:    psp.ProblemID,
			Weight:       psp.Weight,
		}
	}
	return problems
}

// convertProblemSetBundleToProto converts legacy ProblemSetBundle to pb.ProblemSetBundle recursively
func convertProblemSetBundleToProto(psb *ProblemSetBundle) *pb.ProblemSetBundle {
	return &pb.ProblemSetBundle{
		ProblemSet:         convertProblemSetToProto(psb.ProblemSet),
		ProblemSetProblems: convertProblemSetProblemsToProto(psb.ProblemSetProblems),
	}
}

// GetVersion retrieves version information
func (s *codeGrinderServiceServer) GetVersion(ctx context.Context, req *pb.GetVersionRequest) (*pb.GetVersionResponse, error) {
	return &pb.GetVersionResponse{
		Version: &pb.Version{
			Version:                  CurrentVersion.Version,
			GrindVersionRequired:     CurrentVersion.GrindVersionRequired,
			GrindVersionRecommended:  CurrentVersion.GrindVersionRecommended,
			ThonnyVersionRequired:    CurrentVersion.ThonnyVersionRequired,
			ThonnyVersionRecommended: CurrentVersion.ThonnyVersionRecommended,
		},
	}, nil
}

// GetProblemTypes retrieves all problem types
func (s *codeGrinderServiceServer) GetProblemTypes(ctx context.Context, req *pb.GetProblemTypesRequest) (*pb.GetProblemTypesResponse, error) {
	var problemTypes []*pb.ProblemType

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get problem types
		typesProblemTypes, err := getProblemTypes(tx)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem types: %v", err)
		}

		// Convert to proto
		for _, pt := range typesProblemTypes {
			problemTypes = append(problemTypes, convertProblemTypeToProto(pt))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemTypesResponse{ProblemTypes: problemTypes}, nil
}

// GetProblemType retrieves a specific problem type
func (s *codeGrinderServiceServer) GetProblemType(ctx context.Context, req *pb.GetProblemTypeRequest) (*pb.GetProblemTypeResponse, error) {
	var problemType *pb.ProblemType

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get problem type
		typesProblemType, err := getProblemType(tx, req.Name)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem type: %v", err)
		}
		problemType = convertProblemTypeToProto(typesProblemType)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemTypeResponse{ProblemType: problemType}, nil
}

// GetProblems retrieves problems with optional filters
func (s *codeGrinderServiceServer) GetProblems(ctx context.Context, req *pb.GetProblemsRequest) (*pb.GetProblemsResponse, error) {
	var problems []*pb.Problem

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problems
		typesProblems, err := getProblems(tx, currentUser, req.Unique, req.ProblemType, req.Note)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problems: %v", err)
		}
		for _, p := range typesProblems {
			problems = append(problems, convertProblemToProto(p))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemsResponse{Problems: problems}, nil
}

// GetProblem retrieves a specific problem
func (s *codeGrinderServiceServer) GetProblem(ctx context.Context, req *pb.GetProblemRequest) (*pb.GetProblemResponse, error) {
	var problem *pb.Problem

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem
		typesProblem, err := getProblem(tx, req.ProblemId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem: %v", err)
		}
		problem = convertProblemToProto(typesProblem)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemResponse{Problem: problem}, nil
}

// GetProblemSteps retrieves steps for a problem
func (s *codeGrinderServiceServer) GetProblemSteps(ctx context.Context, req *pb.GetProblemStepsRequest) (*pb.GetProblemStepsResponse, error) {
	var problemSteps []*pb.ProblemStep

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem steps
		typesProblemSteps, err := getProblemSteps(tx, req.ProblemId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem steps: %v", err)
		}
		for _, ps := range typesProblemSteps {
			problemSteps = append(problemSteps, convertProblemStepToProto(ps))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemStepsResponse{ProblemSteps: problemSteps}, nil
}

// GetProblemStep retrieves a specific step
func (s *codeGrinderServiceServer) GetProblemStep(ctx context.Context, req *pb.GetProblemStepRequest) (*pb.GetProblemStepResponse, error) {
	var problemStep *pb.ProblemStep

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem step
		typesProblemStep, err := getProblemStep(tx, req.ProblemId, req.Step, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem step: %v", err)
		}
		problemStep = convertProblemStepToProto(typesProblemStep)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemStepResponse{ProblemStep: problemStep}, nil
}

// GetProblemSets retrieves problem sets with optional filters
func (s *codeGrinderServiceServer) GetProblemSets(ctx context.Context, req *pb.GetProblemSetsRequest) (*pb.GetProblemSetsResponse, error) {
	var problemSets []*pb.ProblemSet

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem sets
		typesProblemSets, err := getProblemSets(tx, currentUser, req.Unique, req.Note, req.Search)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem sets: %v", err)
		}
		for _, ps := range typesProblemSets {
			problemSets = append(problemSets, convertProblemSetToProto(ps))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemSetsResponse{ProblemSets: problemSets}, nil
}

// GetProblemSet retrieves a specific problem set
func (s *codeGrinderServiceServer) GetProblemSet(ctx context.Context, req *pb.GetProblemSetRequest) (*pb.GetProblemSetResponse, error) {
	var problemSet *pb.ProblemSet

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem set
		typesProblemSet, err := getProblemSet(tx, req.ProblemSetId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem set: %v", err)
		}
		problemSet = convertProblemSetToProto(typesProblemSet)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemSetResponse{ProblemSet: problemSet}, nil
}

// GetProblemSetProblems retrieves problems in a problem set
func (s *codeGrinderServiceServer) GetProblemSetProblems(ctx context.Context, req *pb.GetProblemSetProblemsRequest) (*pb.GetProblemSetProblemsResponse, error) {
	var problemSetProblems []*pb.ProblemSetProblem

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get problem set problems
		typesProblemSetProblems, err := getProblemSetProblems(tx, req.ProblemSetId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem set problems: %v", err)
		}
		for _, psp := range typesProblemSetProblems {
			problemSetProblems = append(problemSetProblems, convertProblemSetProblemToProto(psp))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetProblemSetProblemsResponse{ProblemSetProblems: problemSetProblems}, nil
}

// GetCourses retrieves courses with optional filters
func (s *codeGrinderServiceServer) GetCourses(ctx context.Context, req *pb.GetCoursesRequest) (*pb.GetCoursesResponse, error) {
	var courses []*pb.Course

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get courses
		typesCourses, err := getCourses(tx, currentUser, req.LtiLabel, req.Name)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting courses: %v", err)
		}
		for _, c := range typesCourses {
			courses = append(courses, convertCourseToProto(c))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetCoursesResponse{Courses: courses}, nil
}

// GetCourse retrieves a specific course
func (s *codeGrinderServiceServer) GetCourse(ctx context.Context, req *pb.GetCourseRequest) (*pb.GetCourseResponse, error) {
	var course *pb.Course

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get course
		typesCourse, err := getCourse(tx, req.CourseId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course: %v", err)
		}
		course = convertCourseToProto(typesCourse)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetCourseResponse{Course: course}, nil
}

// GetUsers retrieves users with optional filters
func (s *codeGrinderServiceServer) GetUsers(ctx context.Context, req *pb.GetUsersRequest) (*pb.GetUsersResponse, error) {
	var users []*pb.User

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get users
		typesUsers, err := getUsers(tx, currentUser, req.Name, req.Email, req.Instructor, req.Admin)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting users: %v", err)
		}
		for _, u := range typesUsers {
			users = append(users, convertUserToProto(u))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetUsersResponse{Users: users}, nil
}

// GetUserMe retrieves the current user
func (s *codeGrinderServiceServer) GetUserMe(ctx context.Context, req *pb.GetUserMeRequest) (*pb.GetUserMeResponse, error) {
	var user *pb.User

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get user me
		typesUser, err := getUserMe(tx, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user me: %v", err)
		}
		user = convertUserToProto(typesUser)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetUserMeResponse{User: user}, nil
}

// GetUser retrieves a specific user
func (s *codeGrinderServiceServer) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.GetUserResponse, error) {
	var user *pb.User

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get user
		typesUser, err := getUser(tx, req.UserId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user: %v", err)
		}
		user = convertUserToProto(typesUser)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetUserResponse{User: user}, nil
}

// GetCourseUsers retrieves users in a course
func (s *codeGrinderServiceServer) GetCourseUsers(ctx context.Context, req *pb.GetCourseUsersRequest) (*pb.GetCourseUsersResponse, error) {
	var users []*pb.User

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get course users
		typesUsers, err := getCourseUsers(tx, req.CourseId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course users: %v", err)
		}
		for _, u := range typesUsers {
			users = append(users, convertUserToProto(u))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetCourseUsersResponse{Users: users}, nil
}

// GetUserAssignments retrieves assignments for a user
func (s *codeGrinderServiceServer) GetUserAssignments(ctx context.Context, req *pb.GetUserAssignmentsRequest) (*pb.GetUserAssignmentsResponse, error) {
	var assignments []*pb.Assignment

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get user assignments
		typesAssignments, err := getUserAssignments(tx, req.UserId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user assignments: %v", err)
		}
		for _, a := range typesAssignments {
			assignments = append(assignments, convertAssignmentToProto(a))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetUserAssignmentsResponse{Assignments: assignments}, nil
}

// GetCourseUserAssignments retrieves assignments for a user in a course
func (s *codeGrinderServiceServer) GetCourseUserAssignments(ctx context.Context, req *pb.GetCourseUserAssignmentsRequest) (*pb.GetCourseUserAssignmentsResponse, error) {
	var assignments []*pb.Assignment

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get course user assignments
		typesAssignments, err := getCourseUserAssignments(tx, req.CourseId, req.UserId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course user assignments: %v", err)
		}
		for _, a := range typesAssignments {
			assignments = append(assignments, convertAssignmentToProto(a))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetCourseUserAssignmentsResponse{Assignments: assignments}, nil
}

// GetAssignments retrieves assignments with optional filters
func (s *codeGrinderServiceServer) GetAssignments(ctx context.Context, req *pb.GetAssignmentsRequest) (*pb.GetAssignmentsResponse, error) {
	var assignments []*pb.Assignment

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get assignments
		typesAssignments, err := getAssignments(tx, currentUser, req.Search)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignments: %v", err)
		}
		for _, a := range typesAssignments {
			assignments = append(assignments, convertAssignmentToProto(a))
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetAssignmentsResponse{Assignments: assignments}, nil
}

// GetAssignment retrieves a specific assignment
func (s *codeGrinderServiceServer) GetAssignment(ctx context.Context, req *pb.GetAssignmentRequest) (*pb.GetAssignmentResponse, error) {
	var assignment *pb.Assignment

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get assignment
		typesAssignment, err := getAssignment(tx, req.AssignmentId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment: %v", err)
		}
		assignment = convertAssignmentToProto(typesAssignment)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetAssignmentResponse{Assignment: assignment}, nil
}

// GetAssignmentProblemCommitLast retrieves the last commit for a problem in an assignment
func (s *codeGrinderServiceServer) GetAssignmentProblemCommitLast(ctx context.Context, req *pb.GetAssignmentProblemCommitLastRequest) (*pb.GetAssignmentProblemCommitLastResponse, error) {
	var commit *pb.Commit

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get assignment problem commit last
		typesCommit, err := getAssignmentProblemCommitLast(tx, req.AssignmentId, req.ProblemId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment problem commit last: %v", err)
		}
		if typesCommit != nil {
			commit = convertCommitToProto(typesCommit)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetAssignmentProblemCommitLastResponse{Commit: commit}, nil
}

// GetAssignmentProblemStepCommitLast retrieves the last commit for a step in an assignment
func (s *codeGrinderServiceServer) GetAssignmentProblemStepCommitLast(ctx context.Context, req *pb.GetAssignmentProblemStepCommitLastRequest) (*pb.GetAssignmentProblemStepCommitLastResponse, error) {
	var commit *pb.Commit

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Get assignment problem step commit last
		typesCommit, err := getAssignmentProblemStepCommitLast(tx, req.AssignmentId, req.ProblemId, req.Step, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment problem step commit last: %v", err)
		}
		if typesCommit != nil {
			commit = convertCommitToProto(typesCommit)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetAssignmentProblemStepCommitLastResponse{Commit: commit}, nil
}

// PostProblemBundleUnconfirmed handles unconfirmed problem bundle
func (s *codeGrinderServiceServer) PostProblemBundleUnconfirmed(ctx context.Context, req *pb.PostProblemBundleUnconfirmedRequest) (*pb.PostProblemBundleUnconfirmedResponse, error) {
	var resultBundle *ProblemBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Convert proto to types
		bundle := convertProblemBundleFromProto(req.Bundle)

		// Post problem bundle unconfirmed
		resultBundle, err = signProblemBundleUnconfirmed(tx, currentUser, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting problem bundle unconfirmed: %v", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert the result bundle to proto
	protoBundle := convertProblemBundleToProto(resultBundle)

	return &pb.PostProblemBundleUnconfirmedResponse{Bundle: protoBundle}, nil
}

// PostProblemBundleConfirmed handles confirmed problem bundle
func (s *codeGrinderServiceServer) PostProblemBundleConfirmed(ctx context.Context, req *pb.PostProblemBundleConfirmedRequest) (*pb.PostProblemBundleConfirmedResponse, error) {
	var resultBundle *ProblemBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Convert proto to types
		bundle := convertProblemBundleFromProto(req.Bundle)

		// Post problem bundle confirmed
		resultBundle, err = saveProblemBundleCommon(tx, currentUser, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting problem bundle confirmed: %v", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert the result bundle to proto
	protoBundle := convertProblemBundleToProto(resultBundle)

	return &pb.PostProblemBundleConfirmedResponse{Bundle: protoBundle}, nil
}

// PutProblemBundle handles updating problem bundle
func (s *codeGrinderServiceServer) PutProblemBundle(ctx context.Context, req *pb.PutProblemBundleRequest) (*pb.PutProblemBundleResponse, error) {
	var resultBundle *ProblemBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Convert proto to types
		bundle := convertProblemBundleFromProto(req.Bundle)

		// Put problem bundle
		resultBundle, err = updateProblemBundle(tx, currentUser, req.ProblemId, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error putting problem bundle: %v", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert the result bundle to proto
	protoBundle := convertProblemBundleToProto(resultBundle)

	return &pb.PutProblemBundleResponse{Bundle: protoBundle}, nil
}

// PostProblemSetBundle handles problem set bundle
func (s *codeGrinderServiceServer) PostProblemSetBundle(ctx context.Context, req *pb.PostProblemSetBundleRequest) (*pb.PostProblemSetBundleResponse, error) {
	var resultBundle *ProblemSetBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Convert proto to types
		bundle := convertProblemSetBundleFromProto(req.Bundle)

		// Post problem set bundle
		var err error
		resultBundle, err = createProblemSetBundle(tx, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting problem set bundle: %v", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert the result bundle to proto
	protoBundle := convertProblemSetBundleToProto(resultBundle)

	return &pb.PostProblemSetBundleResponse{Bundle: protoBundle}, nil
}

// PutProblemSetBundle handles updating problem set bundle
func (s *codeGrinderServiceServer) PutProblemSetBundle(ctx context.Context, req *pb.PutProblemSetBundleRequest) (*pb.PutProblemSetBundleResponse, error) {
	var resultBundle *ProblemSetBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Convert proto to types
		bundle := convertProblemSetBundleFromProto(req.Bundle)

		// Put problem set bundle
		var err error
		resultBundle, err = updateProblemSetBundle(tx, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error putting problem set bundle: %v", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Convert the result bundle to proto
	protoBundle := convertProblemSetBundleToProto(resultBundle)

	return &pb.PutProblemSetBundleResponse{Bundle: protoBundle}, nil
}

// PostCommitBundlesUnsigned handles unsigned commit bundle
func (s *codeGrinderServiceServer) PostCommitBundlesUnsigned(ctx context.Context, req *pb.PostCommitBundlesUnsignedRequest) (*pb.PostCommitBundlesUnsignedResponse, error) {
	var resultBundle *pb.CommitBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Convert proto to types
		bundle := convertCommitBundleFromProto(req.Bundle)

		// Post commit bundles unsigned
		result, err := saveCommitBundleCommon(time.Now(), tx, currentUser, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting commit bundles unsigned: %v", err)
		}

		resultBundle = convertCommitBundleToProto(result)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.PostCommitBundlesUnsignedResponse{Bundle: resultBundle}, nil
}

// PostCommitBundlesSigned handles signed commit bundle
func (s *codeGrinderServiceServer) PostCommitBundlesSigned(ctx context.Context, req *pb.PostCommitBundlesSignedRequest) (*pb.PostCommitBundlesSignedResponse, error) {
	var resultBundle *pb.CommitBundle

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Get current user
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		// Convert proto to types
		bundle := convertCommitBundleFromProto(req.Bundle)

		// Post commit bundles signed
		result, err := saveCommitBundleCommon(time.Now(), tx, currentUser, bundle)
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting commit bundles signed: %v", err)
		}

		resultBundle = convertCommitBundleToProto(result)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.PostCommitBundlesSignedResponse{Bundle: resultBundle}, nil
}

// Daycare handles streaming daycare requests
func (s *codeGrinderServiceServer) Daycare(req *pb.DaycareRequest, stream pb.CodeGrinderService_DaycareServer) error {
	// Get context from the stream
	ctx := stream.Context()

	// Convert protobuf request to legacy types
	commitBundle, problemType, action, args, err := convertDaycareRequestFromProto(req)
	if err != nil {
		return err
	}

	// Create a channel for responses (do NOT close it here)
	eventChan := make(chan *DaycareResponse, 100)

	// Launch HandleProblemAction in a goroutine (it will close the channel)
	go HandleProblemAction(commitBundle, problemType, action, args, eventChan)

	// Main loop: read from channel and stream via gRPC
	// NEVER break early; always drain until channel is closed
	broken := false
	for response := range eventChan {
		if broken {
			// Continue draining to prevent deadlock
			continue
		}
		if err := stream.Send(convertDaycareResponseToProto(response)); err != nil {
			log.Printf("gRPC stream send error: %v", err)
			broken = true
			// On context error, set broken but continue draining
			if ctx.Err() != nil {
				broken = true
				// Do NOT break; keep draining
			}
			continue
		}
	}

	return nil
}
