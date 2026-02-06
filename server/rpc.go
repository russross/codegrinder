package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

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
			elapsed = roundDurationForLog(elapsed)
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

// Hello handles login tokens, cookie validation, and returns version info
func (s *codeGrinderServiceServer) Hello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloResponse, error) {
	version := &pb.Version{
		Version:                  CurrentVersion.Version,
		GrindVersionRequired:     CurrentVersion.GrindVersionRequired,
		GrindVersionRecommended:  CurrentVersion.GrindVersionRecommended,
		ThonnyVersionRequired:    CurrentVersion.ThonnyVersionRequired,
		ThonnyVersionRecommended: CurrentVersion.ThonnyVersionRecommended,
	}

	if req.Key != "" {
		session, err := getUserSession(req.Key)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}

		cookieValue, err := session.Encode()
		if err != nil {
			return nil, status.Errorf(codes.Internal, "error encoding session: %v", err)
		}

		var user *pb.User
		err = withTXForGRPC(ctx, func(tx *sql.Tx) error {
			currentUser, err := getCurrentUserFromSession(tx, session)
			if err != nil {
				return err
			}

			restUser, err := getUserMe(tx, currentUser)
			if err != nil {
				return status.Errorf(codes.Internal, "db error getting user me: %v", err)
			}
			user = pb.ToRPCUser(restUser)

			return nil
		})
		if err != nil {
			return nil, err
		}

		return &pb.HelloResponse{
			Cookie:  fmt.Sprintf("%s=%s", CookieName, cookieValue),
			User:    user,
			Version: version,
		}, nil
	}

	var user *pb.User
	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		session, err := getSessionFromGRPC(ctx)
		if err != nil {
			return err
		}
		currentUser, err := getCurrentUserFromSession(tx, session)
		if err != nil {
			return err
		}

		restUser, err := getUserMe(tx, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user me: %v", err)
		}
		user = pb.ToRPCUser(restUser)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.HelloResponse{
		User:    user,
		Version: version,
	}, nil
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
		user = pb.ToRPCUser(currentUser)

		// Get assignments
		typeAssignments, err = getUserAssignments(tx, session.UserID, currentUser, IPFilterAllowed(ctx))
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
				pbCourse := pb.ToRPCCourse(course)
				courseMap[asst.CourseID] = pbCourse
			}

			// Get problem set if not already fetched
			if _, exists := problemSetMap[asst.ProblemSetID]; !exists {
				problemSet, err := getProblemSet(tx, asst.ProblemSetID, currentUser)
				if err != nil {
					return status.Errorf(codes.Internal, "db error getting problem set: %v", err)
				}
				pbProblemSet := pb.ToRPCProblemSet(problemSet)
				problemSetMap[asst.ProblemSetID] = pbProblemSet
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
		pbAssignment := pb.ToRPCAssignment(asst)
		protoAssignments = append(protoAssignments, pbAssignment)
	}

	return &pb.ListProblemsResponse{
		User:        user,
		Assignments: protoAssignments,
		Courses:     courses,
		ProblemSets: problemSets,
	}, nil
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
		restProblemTypes, err := getProblemTypes(tx)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem types: %v", err)
		}

		// Convert to proto
		for _, pt := range restProblemTypes {
			pbProblemType := pb.ToRPCProblemType(pt)
			problemTypes = append(problemTypes, pbProblemType)
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
		restProblemType, err := getProblemType(tx, req.Name)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem type: %v", err)
		}
		problemType = pb.ToRPCProblemType(restProblemType)

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
		restProblems, err := getProblems(tx, currentUser, req.Unique, req.ProblemType, req.Note)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problems: %v", err)
		}
		for _, p := range restProblems {
			pbProblem := pb.ToRPCProblem(p)
			problems = append(problems, pbProblem)
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
		restProblem, err := getProblem(tx, req.ProblemId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem: %v", err)
		}
		problem = pb.ToRPCProblem(restProblem)

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
		restProblemSteps, err := getProblemSteps(tx, req.ProblemId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem steps: %v", err)
		}
		for _, ps := range restProblemSteps {
			pbProblemStep := pb.ToRPCProblemStep(ps)
			problemSteps = append(problemSteps, pbProblemStep)
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
		restProblemStep, err := getProblemStep(tx, req.ProblemId, req.Step, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem step: %v", err)
		}
		problemStep = pb.ToRPCProblemStep(restProblemStep)

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
		restProblemSets, err := getProblemSets(tx, currentUser, req.Unique, req.Note, req.Search)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem sets: %v", err)
		}
		for _, ps := range restProblemSets {
			pbProblemSet := pb.ToRPCProblemSet(ps)
			problemSets = append(problemSets, pbProblemSet)
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
		restProblemSet, err := getProblemSet(tx, req.ProblemSetId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem set: %v", err)
		}
		problemSet = pb.ToRPCProblemSet(restProblemSet)

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
		restProblemSetProblems, err := getProblemSetProblems(tx, req.ProblemSetId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting problem set problems: %v", err)
		}
		for _, psp := range restProblemSetProblems {
			pbProblemSetProblem := pb.ToRPCProblemSetProblem(psp)
			problemSetProblems = append(problemSetProblems, pbProblemSetProblem)
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
		restCourses, err := getCourses(tx, currentUser, req.LtiLabel, req.Name)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting courses: %v", err)
		}
		for _, c := range restCourses {
			pbCourse := pb.ToRPCCourse(c)
			courses = append(courses, pbCourse)
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
		restCourse, err := getCourse(tx, req.CourseId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course: %v", err)
		}
		course = pb.ToRPCCourse(restCourse)

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
		restUsers, err := getUsers(tx, currentUser, req.Name, req.Email, req.Instructor, req.Admin)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting users: %v", err)
		}
		for _, u := range restUsers {
			pbUser := pb.ToRPCUser(u)
			users = append(users, pbUser)
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
		restUser, err := getUserMe(tx, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user me: %v", err)
		}
		user = pb.ToRPCUser(restUser)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &pb.GetUserMeResponse{User: user}, nil
}

// GetUserSession trades a session key for a cookie
func (s *codeGrinderServiceServer) GetUserSession(ctx context.Context, req *pb.GetUserSessionRequest) (*pb.GetUserSessionResponse, error) {
	// Get the session from the key
	session, err := getUserSession(req.Key)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	// Encode the session into a cookie value
	cookieValue, err := session.Encode()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "error encoding session: %v", err)
	}

	// Return the cookie in the format expected by the CLI
	cookie := fmt.Sprintf("%s=%s", CookieName, cookieValue)
	return &pb.GetUserSessionResponse{Cookie: cookie}, nil
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
		restUser, err := getUser(tx, req.UserId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user: %v", err)
		}
		user = pb.ToRPCUser(restUser)

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
		restUsers, err := getCourseUsers(tx, req.CourseId, currentUser)
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course users: %v", err)
		}
		for _, u := range restUsers {
			pbUser := pb.ToRPCUser(u)
			users = append(users, pbUser)
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
		restAssignments, err := getUserAssignments(tx, req.UserId, currentUser, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting user assignments: %v", err)
		}
		for _, a := range restAssignments {
			pbAssignment := pb.ToRPCAssignment(a)
			assignments = append(assignments, pbAssignment)
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
		restAssignments, err := getCourseUserAssignments(tx, req.CourseId, req.UserId, currentUser, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting course user assignments: %v", err)
		}
		for _, a := range restAssignments {
			pbAssignment := pb.ToRPCAssignment(a)
			assignments = append(assignments, pbAssignment)
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
		restAssignments, err := getAssignments(tx, currentUser, req.Search, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignments: %v", err)
		}
		for _, a := range restAssignments {
			pbAssignment := pb.ToRPCAssignment(a)
			assignments = append(assignments, pbAssignment)
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
		restAssignment, err := getAssignment(tx, req.AssignmentId, currentUser, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment: %v", err)
		}
		assignment = pb.ToRPCAssignment(restAssignment)

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
		restCommit, err := getAssignmentProblemCommitLast(tx, req.AssignmentId, req.ProblemId, currentUser, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment problem commit last: %v", err)
		}
		if restCommit != nil {
			commit = pb.ToRPCCommit(restCommit)
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
		restCommit, err := getAssignmentProblemStepCommitLast(tx, req.AssignmentId, req.ProblemId, req.Step, currentUser, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error getting assignment problem step commit last: %v", err)
		}
		if restCommit != nil {
			commit = pb.ToRPCCommit(restCommit)
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

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

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

		// Convert proto to REST
		bundle := req.Bundle.ToREST()

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
	protoBundle := &pb.ProblemBundle{}
	protoBundle = pb.ToRPCProblemBundle(resultBundle)

	return &pb.PostProblemBundleUnconfirmedResponse{Bundle: protoBundle}, nil
}

// PostProblemBundleConfirmed handles confirmed problem bundle
func (s *codeGrinderServiceServer) PostProblemBundleConfirmed(ctx context.Context, req *pb.PostProblemBundleConfirmedRequest) (*pb.PostProblemBundleConfirmedResponse, error) {
	var resultBundle *ProblemBundle

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

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
		bundle := req.Bundle.ToREST()

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
	protoBundle := pb.ToRPCProblemBundle(resultBundle)

	return &pb.PostProblemBundleConfirmedResponse{Bundle: protoBundle}, nil
}

// PutProblemBundle handles updating problem bundle
func (s *codeGrinderServiceServer) PutProblemBundle(ctx context.Context, req *pb.PutProblemBundleRequest) (*pb.PutProblemBundleResponse, error) {
	var resultBundle *ProblemBundle

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

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
		bundle := req.Bundle.ToREST()

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
	protoBundle := pb.ToRPCProblemBundle(resultBundle)

	return &pb.PutProblemBundleResponse{Bundle: protoBundle}, nil
}

// PostProblemSetBundle handles problem set bundle
func (s *codeGrinderServiceServer) PostProblemSetBundle(ctx context.Context, req *pb.PostProblemSetBundleRequest) (*pb.PostProblemSetBundleResponse, error) {
	var resultBundle *ProblemSetBundle

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Convert proto to types
		bundle := req.Bundle.ToREST()

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
	protoBundle := pb.ToRPCProblemSetBundle(resultBundle)

	return &pb.PostProblemSetBundleResponse{Bundle: protoBundle}, nil
}

// PutProblemSetBundle handles updating problem set bundle
func (s *codeGrinderServiceServer) PutProblemSetBundle(ctx context.Context, req *pb.PutProblemSetBundleRequest) (*pb.PutProblemSetBundleResponse, error) {
	var resultBundle *ProblemSetBundle

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

	err := withTXForGRPC(ctx, func(tx *sql.Tx) error {
		// Convert proto to types
		bundle := req.Bundle.ToREST()

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
	protoBundle := pb.ToRPCProblemSetBundle(resultBundle)

	return &pb.PutProblemSetBundleResponse{Bundle: protoBundle}, nil
}

// PostCommitBundlesUnsigned handles unsigned commit bundle
func (s *codeGrinderServiceServer) PostCommitBundlesUnsigned(ctx context.Context, req *pb.PostCommitBundlesUnsignedRequest) (*pb.PostCommitBundlesUnsignedResponse, error) {
	var resultBundle *pb.CommitBundle

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

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

		// Convert proto to REST
		bundle := req.Bundle.ToREST()
		bundle.Hostname = ""
		bundle.Commit.Transcript = []*EventMessage{}
		bundle.Commit.ReportCard = nil
		bundle.Commit.Score = 0.0
		now := time.Now()
		bundle.Commit.CreatedAt = now
		bundle.Commit.UpdatedAt = now

		// Post commit bundles unsigned
		result, err := saveCommitBundleCommon(time.Now(), tx, currentUser, bundle, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting commit bundles unsigned: %v", err)
		}

		resultBundle = pb.ToRPCCommitBundle(result)

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

	if req == nil || req.Bundle == nil {
		return nil, status.Error(codes.InvalidArgument, "bundle is required")
	}

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

		// Convert proto to REST
		bundle := req.Bundle.ToREST()

		// Post commit bundles signed
		result, err := saveCommitBundleCommon(time.Now(), tx, currentUser, bundle, IPFilterAllowed(ctx))
		if err != nil {
			return status.Errorf(codes.Internal, "db error posting commit bundles signed: %v", err)
		}

		resultBundle = pb.ToRPCCommitBundle(result)

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

	if req == nil {
		return status.Error(codes.InvalidArgument, "request is required")
	}
	if req.CommitBundle == nil {
		return status.Error(codes.InvalidArgument, "commit bundle is required")
	}

	// Convert protobuf request to legacy types
	commitBundle := req.CommitBundle.ToREST()
	problemType := req.ProblemType
	action := req.Action
	args := req.Args

	// Create a channel for responses (do NOT close it here)
	eventChan := make(chan *DaycareResponse, 100)

	// Launch HandleProblemAction in a goroutine (it will close the channel)
	go HandleProblemAction(ctx, commitBundle, problemType, action, args, eventChan)

	// Main loop: read from channel and stream via gRPC
	// NEVER break early; always drain until channel is closed
	broken := false
	for response := range eventChan {
		if broken {
			// Continue draining to prevent deadlock
			continue
		}
		var pbResponse *pb.DaycareResponse
		if response.Event != nil {
			pbResponse = &pb.DaycareResponse{
				Response: &pb.DaycareResponse_Event{Event: pb.ToRPCEventMessage(response.Event)},
			}
		} else if response.Error != "" {
			pbResponse = &pb.DaycareResponse{
				Response: &pb.DaycareResponse_Error{Error: response.Error},
			}
		} else if response.CommitBundle != nil {
			pbResponse = &pb.DaycareResponse{
				Response: &pb.DaycareResponse_CommitBundle{CommitBundle: pb.ToRPCCommitBundle(response.CommitBundle)},
			}
		}
		if pbResponse == nil {
			// Malformed response; skip to avoid panic
			log.Printf("gRPC Daycare received empty response payload; skipping send")
			continue
		}
		if err := stream.Send(pbResponse); err != nil {
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
