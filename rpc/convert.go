package rpc

import (
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/russross/codegrinder/types"
)

// ToRPCUser converts a REST User to a gRPC User
func ToRPCUser(u *types.User) *User {
	if u == nil {
		return nil
	}
	return &User{
		Id:             u.ID,
		Name:           u.Name,
		Email:          u.Email,
		LtiId:          u.LtiID,
		ImageUrl:       u.ImageURL,
		CanvasLogin:    u.CanvasLogin,
		CanvasId:       u.CanvasID,
		Author:         u.Author,
		Admin:          u.Admin,
		CreatedAt:      timestamppb.New(u.CreatedAt),
		UpdatedAt:      timestamppb.New(u.UpdatedAt),
		LastSignedInAt: timestamppb.New(u.LastSignedInAt),
	}
}

// ToRPCCourse converts a REST Course to a gRPC Course
func ToRPCCourse(c *types.Course) *Course {
	if c == nil {
		return nil
	}
	return &Course{
		Id:        c.ID,
		Name:      c.Name,
		Label:     c.Label,
		LtiId:     c.LtiID,
		CanvasId:  c.CanvasID,
		CreatedAt: timestamppb.New(c.CreatedAt),
		UpdatedAt: timestamppb.New(c.UpdatedAt),
	}
}

// ToRPCAssignment converts a REST Assignment to a gRPC Assignment
func ToRPCAssignment(a *types.Assignment) *Assignment {
	if a == nil {
		return nil
	}
	rawScores := make(map[string]*ScoreList)
	if a.RawScores != nil {
		for k, v := range a.RawScores {
			rawScores[k] = &ScoreList{Scores: v}
		}
	}

	var unlockAt, dueAt, lockAt *timestamppb.Timestamp
	if a.UnlockAt != nil {
		unlockAt = timestamppb.New(*a.UnlockAt)
	}
	if a.DueAt != nil {
		dueAt = timestamppb.New(*a.DueAt)
	}
	if a.LockAt != nil {
		lockAt = timestamppb.New(*a.LockAt)
	}

	return &Assignment{
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
		UnlockAt:           unlockAt,
		DueAt:              dueAt,
		LockAt:             lockAt,
		CreatedAt:          timestamppb.New(a.CreatedAt),
		UpdatedAt:          timestamppb.New(a.UpdatedAt),
	}
}

// ToRPCProblemSet converts a REST ProblemSet to a gRPC ProblemSet
func ToRPCProblemSet(ps *types.ProblemSet) *ProblemSet {
	if ps == nil {
		return nil
	}
	return &ProblemSet{
		Id:        ps.ID,
		Unique:    ps.Unique,
		Note:      ps.Note,
		Tags:      ps.Tags,
		CreatedAt: timestamppb.New(ps.CreatedAt),
		UpdatedAt: timestamppb.New(ps.UpdatedAt),
	}
}

// ToRPCProblemType converts a REST ProblemType to a gRPC ProblemType
func ToRPCProblemType(pt *types.ProblemType) *ProblemType {
	if pt == nil {
		return nil
	}
	actions := make(map[string]*ProblemTypeAction)
	if pt.Actions != nil {
		for k, v := range pt.Actions {
			actions[k] = &ProblemTypeAction{
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
	}
	return &ProblemType{
		Name:    pt.Name,
		Image:   pt.Image,
		Files:   pt.Files,
		Actions: actions,
	}
}

// ToRPCProblem converts a REST Problem to a gRPC Problem
func ToRPCProblem(p *types.Problem) *Problem {
	if p == nil {
		return nil
	}
	return &Problem{
		Id:        p.ID,
		Unique:    p.Unique,
		Note:      p.Note,
		Tags:      p.Tags,
		Options:   p.Options,
		CreatedAt: timestamppb.New(p.CreatedAt),
		UpdatedAt: timestamppb.New(p.UpdatedAt),
	}
}

// ToRPCProblemStep converts a REST ProblemStep to a gRPC ProblemStep
func ToRPCProblemStep(ps *types.ProblemStep) *ProblemStep {
	if ps == nil {
		return nil
	}
	return &ProblemStep{
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

// ToRPCProblemSetProblem converts a REST ProblemSetProblem to a gRPC ProblemSetProblem
func ToRPCProblemSetProblem(psp *types.ProblemSetProblem) *ProblemSetProblem {
	if psp == nil {
		return nil
	}
	return &ProblemSetProblem{
		ProblemSetId: psp.ProblemSetID,
		ProblemId:    psp.ProblemID,
		Weight:       psp.Weight,
	}
}

// ToRPCReportCard converts a REST ReportCard to a gRPC ReportCard
func ToRPCReportCard(rc *types.ReportCard) *ReportCard {
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
	return &ReportCard{
		Passed:   rc.Passed,
		Note:     rc.Note,
		Duration: durationpb.New(rc.Duration),
		Results:  results,
	}
}

// ToRPCEventMessage converts a REST EventMessage to a gRPC EventMessage
func ToRPCEventMessage(em *types.EventMessage) *EventMessage {
	if em == nil {
		return nil
	}
	var reportCard *ReportCard
	if em.ReportCard != nil {
		reportCard = ToRPCReportCard(em.ReportCard)
	}
	return &EventMessage{
		Time:        timestamppb.New(em.Time),
		Event:       em.Event,
		ExecCommand: em.ExecCommand,
		ExitStatus:  int32(em.ExitStatus),
		StreamData:  em.StreamData,
		Error:       em.Error,
		ReportCard:  reportCard,
		Files:       em.Files,
	}
}

// ToRPCCommit converts a REST Commit to a gRPC Commit
func ToRPCCommit(c *types.Commit) *Commit {
	if c == nil {
		return nil
	}
	transcript := make([]*EventMessage, len(c.Transcript))
	for i, t := range c.Transcript {
		transcript[i] = ToRPCEventMessage(t)
	}
	var reportCard *ReportCard
	if c.ReportCard != nil {
		reportCard = ToRPCReportCard(c.ReportCard)
	}
	return &Commit{
		Id:           c.ID,
		AssignmentId: c.AssignmentID,
		ProblemId:    c.ProblemID,
		Step:         c.Step,
		Action:       c.Action,
		Note:         c.Note,
		Files:        c.Files,
		Transcript:   transcript,
		ReportCard:   reportCard,
		Score:        c.Score,
		CreatedAt:    timestamppb.New(c.CreatedAt),
		UpdatedAt:    timestamppb.New(c.UpdatedAt),
	}
}

// ToRPCProblemBundle converts a REST ProblemBundle to a gRPC ProblemBundle
func ToRPCProblemBundle(pb *types.ProblemBundle) *ProblemBundle {
	if pb == nil {
		return nil
	}
	problemTypes := make(map[string]*ProblemType)
	if pb.ProblemTypes != nil {
		for k, v := range pb.ProblemTypes {
			problemTypes[k] = ToRPCProblemType(v)
		}
	}
	commits := make([]*Commit, len(pb.Commits))
	for i, c := range pb.Commits {
		commits[i] = ToRPCCommit(c)
	}
	var problem *Problem
	if pb.Problem != nil {
		problem = ToRPCProblem(pb.Problem)
	}
	return &ProblemBundle{
		ProblemTypes:          problemTypes,
		ProblemTypeSignatures: pb.ProblemTypeSignatures,
		Problem:               problem,
		ProblemSteps:          convertProblemStepsToRPC(pb.ProblemSteps),
		ProblemSignature:      pb.ProblemSignature,
		Hostname:              pb.Hostname,
		UserId:                pb.UserID,
		Commits:               commits,
		CommitSignatures:      pb.CommitSignatures,
	}
}

// ToRPCProblemSetBundle converts a REST ProblemSetBundle to a gRPC ProblemSetBundle
func ToRPCProblemSetBundle(psb *types.ProblemSetBundle) *ProblemSetBundle {
	if psb == nil {
		return nil
	}
	var problemSet *ProblemSet
	if psb.ProblemSet != nil {
		problemSet = ToRPCProblemSet(psb.ProblemSet)
	}
	return &ProblemSetBundle{
		ProblemSet:         problemSet,
		ProblemSetProblems: convertProblemSetProblemsToRPC(psb.ProblemSetProblems),
	}
}

// ToRPCCommitBundle converts a REST CommitBundle to a gRPC CommitBundle
func ToRPCCommitBundle(cb *types.CommitBundle) *CommitBundle {
	if cb == nil {
		return nil
	}
	var problemType *ProblemType
	if cb.ProblemType != nil {
		problemType = ToRPCProblemType(cb.ProblemType)
	}
	var problem *Problem
	if cb.Problem != nil {
		problem = ToRPCProblem(cb.Problem)
	}
	var commit *Commit
	if cb.Commit != nil {
		commit = ToRPCCommit(cb.Commit)
	}
	return &CommitBundle{
		ProblemType:          problemType,
		ProblemTypeSignature: cb.ProblemTypeSignature,
		Problem:              problem,
		ProblemSteps:         convertProblemStepsToRPC(cb.ProblemSteps),
		ProblemSignature:     cb.ProblemSignature,
		Action:               cb.Action,
		Hostname:             cb.Hostname,
		UserId:               cb.UserID,
		Commit:               commit,
		CommitSignature:      cb.CommitSignature,
	}
}

// Helper functions for slice conversions
func convertProblemStepsToRPC(pss []*types.ProblemStep) []*ProblemStep {
	steps := make([]*ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = ToRPCProblemStep(ps)
	}
	return steps
}

func convertProblemSetProblemsToRPC(psps []*types.ProblemSetProblem) []*ProblemSetProblem {
	problems := make([]*ProblemSetProblem, len(psps))
	for i, psp := range psps {
		problems[i] = ToRPCProblemSetProblem(psp)
	}
	return problems
}

// ToREST converts a gRPC User to a REST User
func (u *User) ToREST() *types.User {
	if u == nil {
		return nil
	}
	return &types.User{
		ID:             u.Id,
		Name:           u.Name,
		Email:          u.Email,
		LtiID:          u.LtiId,
		ImageURL:       u.ImageUrl,
		CanvasLogin:    u.CanvasLogin,
		CanvasID:       u.CanvasId,
		Author:         u.Author,
		Admin:          u.Admin,
		CreatedAt:      u.CreatedAt.AsTime(),
		UpdatedAt:      u.UpdatedAt.AsTime(),
		LastSignedInAt: u.LastSignedInAt.AsTime(),
	}
}

// ToREST converts a gRPC Course to a REST Course
func (c *Course) ToREST() *types.Course {
	if c == nil {
		return nil
	}
	return &types.Course{
		ID:        c.Id,
		Name:      c.Name,
		Label:     c.Label,
		LtiID:     c.LtiId,
		CanvasID:  c.CanvasId,
		CreatedAt: c.CreatedAt.AsTime(),
		UpdatedAt: c.UpdatedAt.AsTime(),
	}
}

// ToREST converts a gRPC Assignment to a REST Assignment
func (a *Assignment) ToREST() *types.Assignment {
	if a == nil {
		return nil
	}
	rawScores := make(map[string][]float64)
	if a.RawScores != nil {
		for k, v := range a.RawScores {
			rawScores[k] = v.Scores
		}
	}

	var unlockAt, dueAt, lockAt *time.Time
	if a.UnlockAt != nil {
		unlockAt = &[]time.Time{a.UnlockAt.AsTime()}[0]
	}
	if a.DueAt != nil {
		dueAt = &[]time.Time{a.DueAt.AsTime()}[0]
	}
	if a.LockAt != nil {
		lockAt = &[]time.Time{a.LockAt.AsTime()}[0]
	}

	return &types.Assignment{
		ID:                 a.Id,
		CourseID:           a.CourseId,
		ProblemSetID:       a.ProblemSetId,
		UserID:             a.UserId,
		Roles:              a.Roles,
		Instructor:         a.Instructor,
		RawScores:          rawScores,
		Score:              a.Score,
		GradeID:            a.GradeId,
		LtiID:              a.LtiId,
		CanvasTitle:        a.CanvasTitle,
		CanvasID:           a.CanvasId,
		CanvasAPIDomain:    a.CanvasApiDomain,
		OutcomeURL:         a.OutcomeUrl,
		OutcomeExtURL:      a.OutcomeExtUrl,
		OutcomeExtAccepted: a.OutcomeExtAccepted,
		FinishedURL:        a.FinishedUrl,
		ConsumerKey:        a.ConsumerKey,
		UnlockAt:           unlockAt,
		DueAt:              dueAt,
		LockAt:             lockAt,
		CreatedAt:          a.CreatedAt.AsTime(),
		UpdatedAt:          a.UpdatedAt.AsTime(),
	}
}

// ToREST converts a gRPC ProblemSet to a REST ProblemSet
func (ps *ProblemSet) ToREST() *types.ProblemSet {
	if ps == nil {
		return nil
	}
	return &types.ProblemSet{
		ID:        ps.Id,
		Unique:    ps.Unique,
		Note:      ps.Note,
		Tags:      ps.Tags,
		CreatedAt: ps.CreatedAt.AsTime(),
		UpdatedAt: ps.UpdatedAt.AsTime(),
	}
}

// ToREST converts a gRPC ProblemType to a REST ProblemType
func (pt *ProblemType) ToREST() *types.ProblemType {
	if pt == nil {
		return nil
	}
	actions := make(map[string]*types.ProblemTypeAction)
	if pt.Actions != nil {
		for k, v := range pt.Actions {
			actions[k] = &types.ProblemTypeAction{
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
	}
	return &types.ProblemType{
		Name:    pt.Name,
		Image:   pt.Image,
		Files:   pt.Files,
		Actions: actions,
	}
}

// ToREST converts a gRPC Problem to a REST Problem
func (p *Problem) ToREST() *types.Problem {
	if p == nil {
		return nil
	}
	return &types.Problem{
		ID:        p.Id,
		Unique:    p.Unique,
		Note:      p.Note,
		Tags:      p.Tags,
		Options:   p.Options,
		CreatedAt: p.CreatedAt.AsTime(),
		UpdatedAt: p.UpdatedAt.AsTime(),
	}
}

// ToREST converts a gRPC ProblemStep to a REST ProblemStep
func (ps *ProblemStep) ToREST() *types.ProblemStep {
	if ps == nil {
		return nil
	}
	return &types.ProblemStep{
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

// ToREST converts a gRPC ProblemSetProblem to a REST ProblemSetProblem
func (psp *ProblemSetProblem) ToREST() *types.ProblemSetProblem {
	if psp == nil {
		return nil
	}
	return &types.ProblemSetProblem{
		ProblemSetID: psp.ProblemSetId,
		ProblemID:    psp.ProblemId,
		Weight:       psp.Weight,
	}
}

// ToREST converts a gRPC ReportCard to a REST ReportCard
func (rc *ReportCard) ToREST() *types.ReportCard {
	if rc == nil {
		return nil
	}
	results := make([]*types.ReportCardResult, len(rc.Results))
	for i, r := range rc.Results {
		results[i] = &types.ReportCardResult{
			Name:    r.Name,
			Outcome: r.Outcome,
			Details: r.Details,
			Context: r.Context,
		}
	}
	return &types.ReportCard{
		Passed:   rc.Passed,
		Note:     rc.Note,
		Duration: rc.Duration.AsDuration(),
		Results:  results,
	}
}

// ToREST converts a gRPC EventMessage to a REST EventMessage
func (em *EventMessage) ToREST() *types.EventMessage {
	if em == nil {
		return nil
	}
	var reportCard *types.ReportCard
	if em.ReportCard != nil {
		reportCard = em.ReportCard.ToREST()
	}
	return &types.EventMessage{
		Time:        em.Time.AsTime(),
		Event:       em.Event,
		ExecCommand: em.ExecCommand,
		ExitStatus:  int(em.ExitStatus),
		StreamData:  em.StreamData,
		Error:       em.Error,
		ReportCard:  reportCard,
		Files:       em.Files,
	}
}

// ToREST converts a gRPC Commit to a REST Commit
func (c *Commit) ToREST() *types.Commit {
	if c == nil {
		return nil
	}
	transcript := make([]*types.EventMessage, len(c.Transcript))
	for i, t := range c.Transcript {
		transcript[i] = t.ToREST()
	}
	var reportCard *types.ReportCard
	if c.ReportCard != nil {
		reportCard = c.ReportCard.ToREST()
	}
	return &types.Commit{
		ID:           c.Id,
		AssignmentID: c.AssignmentId,
		ProblemID:    c.ProblemId,
		Step:         c.Step,
		Action:       c.Action,
		Note:         c.Note,
		Files:        c.Files,
		Transcript:   transcript,
		ReportCard:   reportCard,
		Score:        c.Score,
		CreatedAt:    c.CreatedAt.AsTime(),
		UpdatedAt:    c.UpdatedAt.AsTime(),
	}
}

// ToREST converts a gRPC ProblemBundle to a REST ProblemBundle
func (pb *ProblemBundle) ToREST() *types.ProblemBundle {
	if pb == nil {
		return nil
	}
	problemTypes := make(map[string]*types.ProblemType)
	if pb.ProblemTypes != nil {
		for k, v := range pb.ProblemTypes {
			problemTypes[k] = v.ToREST()
		}
	}
	commits := make([]*types.Commit, len(pb.Commits))
	for i, c := range pb.Commits {
		commits[i] = c.ToREST()
	}
	return &types.ProblemBundle{
		ProblemTypes:          problemTypes,
		ProblemTypeSignatures: pb.ProblemTypeSignatures,
		Problem:               pb.Problem.ToREST(),
		ProblemSteps:          convertProblemStepsToREST(pb.ProblemSteps),
		ProblemSignature:      pb.ProblemSignature,
		Hostname:              pb.Hostname,
		UserID:                pb.UserId,
		Commits:               commits,
		CommitSignatures:      pb.CommitSignatures,
	}
}

// ToREST converts a gRPC ProblemSetBundle to a REST ProblemSetBundle
func (psb *ProblemSetBundle) ToREST() *types.ProblemSetBundle {
	if psb == nil {
		return nil
	}
	return &types.ProblemSetBundle{
		ProblemSet:         psb.ProblemSet.ToREST(),
		ProblemSetProblems: convertProblemSetProblemsToREST(psb.ProblemSetProblems),
	}
}

// ToREST converts a gRPC CommitBundle to a REST CommitBundle
func (cb *CommitBundle) ToREST() *types.CommitBundle {
	if cb == nil {
		return nil
	}
	return &types.CommitBundle{
		ProblemType:          cb.ProblemType.ToREST(),
		ProblemTypeSignature: cb.ProblemTypeSignature,
		Problem:              cb.Problem.ToREST(),
		ProblemSteps:         convertProblemStepsToREST(cb.ProblemSteps),
		ProblemSignature:     cb.ProblemSignature,
		Action:               cb.Action,
		Hostname:             cb.Hostname,
		UserID:               cb.UserId,
		Commit:               cb.Commit.ToREST(),
		CommitSignature:      cb.CommitSignature,
	}
}

// Helper functions for slice conversions
func convertProblemStepsToREST(pss []*ProblemStep) []*types.ProblemStep {
	steps := make([]*types.ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = ps.ToREST()
	}
	return steps
}

func convertProblemSetProblemsToREST(psps []*ProblemSetProblem) []*types.ProblemSetProblem {
	problems := make([]*types.ProblemSetProblem, len(psps))
	for i, psp := range psps {
		problems[i] = psp.ToREST()
	}
	return problems
}
