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
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/russross/codegrinder/rpc"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// versionServiceServer implements the VersionServiceServer interface
type versionServiceServer struct {
	pb.UnimplementedVersionServiceServer
}

// GetVersion returns the current version information
func (s *versionServiceServer) GetVersion(ctx context.Context, req *emptypb.Empty) (*pb.Version, error) {
	return &pb.Version{
		Version:                  CurrentVersion.Version,
		GrindVersionRequired:     CurrentVersion.GrindVersionRequired,
		GrindVersionRecommended:  CurrentVersion.GrindVersionRecommended,
		ThonnyVersionRequired:    CurrentVersion.ThonnyVersionRequired,
		ThonnyVersionRecommended: CurrentVersion.ThonnyVersionRecommended,
	}, nil
}

// taServiceServer implements the TaServiceServer interface
type taServiceServer struct {
	pb.UnimplementedTaServiceServer
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
func (s *taServiceServer) ListProblems(ctx context.Context, req *pb.ListProblemsRequest) (*pb.ListProblemsResponse, error) {
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
