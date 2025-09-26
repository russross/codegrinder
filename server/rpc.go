package main

import (
	"context"

	"google.golang.org/protobuf/types/known/emptypb"

	pb "github.com/russross/codegrinder/rpc"
	. "github.com/russross/codegrinder/types"
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
