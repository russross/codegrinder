package rpc

import (
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/russross/codegrinder/types"
)

// ToREST converts a gRPC User to a REST User
func (u *User) ToREST() *types.User {
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

// FromREST fills in a gRPC User from a REST User
func (u *User) FromREST(rest *types.User) {
	u.Id = rest.ID
	u.Name = rest.Name
	u.Email = rest.Email
	u.LtiId = rest.LtiID
	u.ImageUrl = rest.ImageURL
	u.CanvasLogin = rest.CanvasLogin
	u.CanvasId = rest.CanvasID
	u.Author = rest.Author
	u.Admin = rest.Admin
	u.CreatedAt = timestamppb.New(rest.CreatedAt)
	u.UpdatedAt = timestamppb.New(rest.UpdatedAt)
	u.LastSignedInAt = timestamppb.New(rest.LastSignedInAt)
}

// ToREST converts a gRPC Course to a REST Course
func (c *Course) ToREST() *types.Course {
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

// FromREST fills in a gRPC Course from a REST Course
func (c *Course) FromREST(rest *types.Course) {
	c.Id = rest.ID
	c.Name = rest.Name
	c.Label = rest.Label
	c.LtiId = rest.LtiID
	c.CanvasId = rest.CanvasID
	c.CreatedAt = timestamppb.New(rest.CreatedAt)
	c.UpdatedAt = timestamppb.New(rest.UpdatedAt)
}

// ToREST converts a gRPC Assignment to a REST Assignment
func (a *Assignment) ToREST() *types.Assignment {
	rawScores := make(map[string][]float64)
	for k, v := range a.RawScores {
		rawScores[k] = v.Scores
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

// FromREST fills in a gRPC Assignment from a REST Assignment
func (a *Assignment) FromREST(rest *types.Assignment) {
	rawScores := make(map[string]*ScoreList)
	for k, v := range rest.RawScores {
		rawScores[k] = &ScoreList{Scores: v}
	}

	var unlockAt, dueAt, lockAt *timestamppb.Timestamp
	if rest.UnlockAt != nil {
		unlockAt = timestamppb.New(*rest.UnlockAt)
	}
	if rest.DueAt != nil {
		dueAt = timestamppb.New(*rest.DueAt)
	}
	if rest.LockAt != nil {
		lockAt = timestamppb.New(*rest.LockAt)
	}

	a.Id = rest.ID
	a.CourseId = rest.CourseID
	a.ProblemSetId = rest.ProblemSetID
	a.UserId = rest.UserID
	a.Roles = rest.Roles
	a.Instructor = rest.Instructor
	a.RawScores = rawScores
	a.Score = rest.Score
	a.GradeId = rest.GradeID
	a.LtiId = rest.LtiID
	a.CanvasTitle = rest.CanvasTitle
	a.CanvasId = rest.CanvasID
	a.CanvasApiDomain = rest.CanvasAPIDomain
	a.OutcomeUrl = rest.OutcomeURL
	a.OutcomeExtUrl = rest.OutcomeExtURL
	a.OutcomeExtAccepted = rest.OutcomeExtAccepted
	a.FinishedUrl = rest.FinishedURL
	a.ConsumerKey = rest.ConsumerKey
	a.UnlockAt = unlockAt
	a.DueAt = dueAt
	a.LockAt = lockAt
	a.CreatedAt = timestamppb.New(rest.CreatedAt)
	a.UpdatedAt = timestamppb.New(rest.UpdatedAt)
}

// ToREST converts a gRPC ProblemSet to a REST ProblemSet
func (ps *ProblemSet) ToREST() *types.ProblemSet {
	return &types.ProblemSet{
		ID:        ps.Id,
		Unique:    ps.Unique,
		Note:      ps.Note,
		Tags:      ps.Tags,
		CreatedAt: ps.CreatedAt.AsTime(),
		UpdatedAt: ps.UpdatedAt.AsTime(),
	}
}

// FromREST fills in a gRPC ProblemSet from a REST ProblemSet
func (ps *ProblemSet) FromREST(rest *types.ProblemSet) {
	ps.Id = rest.ID
	ps.Unique = rest.Unique
	ps.Note = rest.Note
	ps.Tags = rest.Tags
	ps.CreatedAt = timestamppb.New(rest.CreatedAt)
	ps.UpdatedAt = timestamppb.New(rest.UpdatedAt)
}

// ToREST converts a gRPC ProblemType to a REST ProblemType
func (pt *ProblemType) ToREST() *types.ProblemType {
	actions := make(map[string]*types.ProblemTypeAction)
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
	return &types.ProblemType{
		Name:    pt.Name,
		Image:   pt.Image,
		Files:   pt.Files,
		Actions: actions,
	}
}

// FromREST fills in a gRPC ProblemType from a REST ProblemType
func (pt *ProblemType) FromREST(rest *types.ProblemType) {
	actions := make(map[string]*ProblemTypeAction)
	for k, v := range rest.Actions {
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
	pt.Name = rest.Name
	pt.Image = rest.Image
	pt.Files = rest.Files
	pt.Actions = actions
}

// ToREST converts a gRPC Problem to a REST Problem
func (p *Problem) ToREST() *types.Problem {
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

// FromREST fills in a gRPC Problem from a REST Problem
func (p *Problem) FromREST(rest *types.Problem) {
	p.Id = rest.ID
	p.Unique = rest.Unique
	p.Note = rest.Note
	p.Tags = rest.Tags
	p.Options = rest.Options
	p.CreatedAt = timestamppb.New(rest.CreatedAt)
	p.UpdatedAt = timestamppb.New(rest.UpdatedAt)
}

// ToREST converts a gRPC ProblemStep to a REST ProblemStep
func (ps *ProblemStep) ToREST() *types.ProblemStep {
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

// FromREST fills in a gRPC ProblemStep from a REST ProblemStep
func (ps *ProblemStep) FromREST(rest *types.ProblemStep) {
	ps.ProblemId = rest.ProblemID
	ps.Step = rest.Step
	ps.ProblemType = rest.ProblemType
	ps.Note = rest.Note
	ps.Instructions = rest.Instructions
	ps.Weight = rest.Weight
	ps.Files = rest.Files
	ps.Whitelist = rest.Whitelist
	ps.Solution = rest.Solution
}

// ToREST converts a gRPC ProblemSetProblem to a REST ProblemSetProblem
func (psp *ProblemSetProblem) ToREST() *types.ProblemSetProblem {
	return &types.ProblemSetProblem{
		ProblemSetID: psp.ProblemSetId,
		ProblemID:    psp.ProblemId,
		Weight:       psp.Weight,
	}
}

// FromREST fills in a gRPC ProblemSetProblem from a REST ProblemSetProblem
func (psp *ProblemSetProblem) FromREST(rest *types.ProblemSetProblem) {
	psp.ProblemSetId = rest.ProblemSetID
	psp.ProblemId = rest.ProblemID
	psp.Weight = rest.Weight
}

// ToREST converts a gRPC ReportCard to a REST ReportCard
func (rc *ReportCard) ToREST() *types.ReportCard {
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

// FromREST fills in a gRPC ReportCard from a REST ReportCard
func (rc *ReportCard) FromREST(rest *types.ReportCard) {
	results := make([]*ReportCardResult, len(rest.Results))
	for i, r := range rest.Results {
		results[i] = &ReportCardResult{
			Name:    r.Name,
			Outcome: r.Outcome,
			Details: r.Details,
			Context: r.Context,
		}
	}
	rc.Passed = rest.Passed
	rc.Note = rest.Note
	rc.Duration = durationpb.New(rest.Duration)
	rc.Results = results
}

// ToREST converts a gRPC EventMessage to a REST EventMessage
func (em *EventMessage) ToREST() *types.EventMessage {
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

// FromREST fills in a gRPC EventMessage from a REST EventMessage
func (em *EventMessage) FromREST(rest *types.EventMessage) {
	em.Time = timestamppb.New(rest.Time)
	em.Event = rest.Event
	em.ExecCommand = rest.ExecCommand
	em.ExitStatus = int32(rest.ExitStatus)
	em.StreamData = rest.StreamData
	em.Error = rest.Error
	if rest.ReportCard != nil {
		em.ReportCard = &ReportCard{}
		em.ReportCard.FromREST(rest.ReportCard)
	}
	em.Files = rest.Files
}

// ToREST converts a gRPC Commit to a REST Commit
func (c *Commit) ToREST() *types.Commit {
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

// FromREST fills in a gRPC Commit from a REST Commit
func (c *Commit) FromREST(rest *types.Commit) {
	transcript := make([]*EventMessage, len(rest.Transcript))
	for i, t := range rest.Transcript {
		transcript[i] = &EventMessage{}
		transcript[i].FromREST(t)
	}
	c.Id = rest.ID
	c.AssignmentId = rest.AssignmentID
	c.ProblemId = rest.ProblemID
	c.Step = rest.Step
	c.Action = rest.Action
	c.Note = rest.Note
	c.Files = rest.Files
	c.Transcript = transcript
	if rest.ReportCard != nil {
		c.ReportCard = &ReportCard{}
		c.ReportCard.FromREST(rest.ReportCard)
	}
	c.Score = rest.Score
	c.CreatedAt = timestamppb.New(rest.CreatedAt)
	c.UpdatedAt = timestamppb.New(rest.UpdatedAt)
}

// ToREST converts a gRPC ProblemBundle to a REST ProblemBundle
func (pb *ProblemBundle) ToREST() *types.ProblemBundle {
	problemTypes := make(map[string]*types.ProblemType)
	for k, v := range pb.ProblemTypes {
		problemTypes[k] = v.ToREST()
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

// FromREST fills in a gRPC ProblemBundle from a REST ProblemBundle
func (pb *ProblemBundle) FromREST(rest *types.ProblemBundle) {
	problemTypes := make(map[string]*ProblemType)
	for k, v := range rest.ProblemTypes {
		problemTypes[k] = &ProblemType{}
		problemTypes[k].FromREST(v)
	}
	commits := make([]*Commit, len(rest.Commits))
	for i, c := range rest.Commits {
		commits[i] = &Commit{}
		commits[i].FromREST(c)
	}
	pb.ProblemTypes = problemTypes
	pb.ProblemTypeSignatures = rest.ProblemTypeSignatures
	if rest.Problem != nil {
		pb.Problem = &Problem{}
		pb.Problem.FromREST(rest.Problem)
	}
	pb.ProblemSteps = convertProblemStepsFromREST(rest.ProblemSteps)
	pb.ProblemSignature = rest.ProblemSignature
	pb.Hostname = rest.Hostname
	pb.UserId = rest.UserID
	pb.Commits = commits
	pb.CommitSignatures = rest.CommitSignatures
}

// ToREST converts a gRPC ProblemSetBundle to a REST ProblemSetBundle
func (psb *ProblemSetBundle) ToREST() *types.ProblemSetBundle {
	return &types.ProblemSetBundle{
		ProblemSet:         psb.ProblemSet.ToREST(),
		ProblemSetProblems: convertProblemSetProblemsToREST(psb.ProblemSetProblems),
	}
}

// FromREST fills in a gRPC ProblemSetBundle from a REST ProblemSetBundle
func (psb *ProblemSetBundle) FromREST(rest *types.ProblemSetBundle) {
	if rest.ProblemSet != nil {
		psb.ProblemSet = &ProblemSet{}
		psb.ProblemSet.FromREST(rest.ProblemSet)
	}
	psb.ProblemSetProblems = convertProblemSetProblemsFromREST(rest.ProblemSetProblems)
}

// ToREST converts a gRPC CommitBundle to a REST CommitBundle
func (cb *CommitBundle) ToREST() *types.CommitBundle {
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

// FromREST fills in a gRPC CommitBundle from a REST CommitBundle
func (cb *CommitBundle) FromREST(rest *types.CommitBundle) {
	if rest.ProblemType != nil {
		cb.ProblemType = &ProblemType{}
		cb.ProblemType.FromREST(rest.ProblemType)
	}
	cb.ProblemTypeSignature = rest.ProblemTypeSignature
	if rest.Problem != nil {
		cb.Problem = &Problem{}
		cb.Problem.FromREST(rest.Problem)
	}
	cb.ProblemSteps = convertProblemStepsFromREST(rest.ProblemSteps)
	cb.ProblemSignature = rest.ProblemSignature
	cb.Action = rest.Action
	cb.Hostname = rest.Hostname
	cb.UserId = rest.UserID
	if rest.Commit != nil {
		cb.Commit = &Commit{}
		cb.Commit.FromREST(rest.Commit)
	}
	cb.CommitSignature = rest.CommitSignature
}

// Helper functions for slice conversions
func convertProblemStepsToREST(pss []*ProblemStep) []*types.ProblemStep {
	steps := make([]*types.ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = ps.ToREST()
	}
	return steps
}

func convertProblemStepsFromREST(pss []*types.ProblemStep) []*ProblemStep {
	steps := make([]*ProblemStep, len(pss))
	for i, ps := range pss {
		steps[i] = &ProblemStep{}
		steps[i].FromREST(ps)
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

func convertProblemSetProblemsFromREST(psps []*types.ProblemSetProblem) []*ProblemSetProblem {
	problems := make([]*ProblemSetProblem, len(psps))
	for i, psp := range psps {
		problems[i] = &ProblemSetProblem{}
		problems[i].FromREST(psp)
	}
	return problems
}
