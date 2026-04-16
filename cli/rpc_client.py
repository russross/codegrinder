from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

import codegrinder_pb2 as pb

from errors import CliError
from helpers import Session, clean_error, dump_message, grpc_metadata
from models import Config

T = TypeVar("T")


@dataclass(slots=True)
class CodeGrinderClient:
    config: Config
    session: Session

    def call(self, name: str, fn: Callable[..., T], request: object) -> T:
        dump_message(self.config, name, True, request)
        try:
            response = fn(request, metadata=grpc_metadata(self.config.cookie))
        except Exception as exc:
            raise CliError(clean_error(exc)) from exc
        dump_message(self.config, name, False, response)
        return response

    def list_assignments(self, search: list[str] | None = None, include_student_context: bool = False) -> pb.ListAssignmentsResponse:
        return self.call(
            "ListAssignments",
            self.session.stub.ListAssignments,
            pb.ListAssignmentsRequest(search=[] if search is None else search, include_student_context=include_student_context),
        )

    def search_problem_catalog(self, search: list[str]) -> pb.SearchProblemCatalogResponse:
        return self.call(
            "SearchProblemCatalog",
            self.session.stub.SearchProblemCatalog,
            pb.SearchProblemCatalogRequest(search=search),
        )

    def get_problem_types(self) -> pb.GetProblemTypesResponse:
        return self.call("GetProblemTypes", self.session.stub.GetProblemTypes, pb.GetProblemTypesRequest())

    def get_problem_type(self, problem_type: str) -> pb.GetProblemTypeResponse:
        return self.call(
            "GetProblemType",
            self.session.stub.GetProblemType,
            pb.GetProblemTypeRequest(problem_type=problem_type),
        )

    def get_assignment(self, assignment: pb.AssignmentKey) -> pb.GetAssignmentResponse:
        return self.call("GetAssignment", self.session.stub.GetAssignment, pb.GetAssignmentRequest(assignment=assignment))

    def get_workspace(
        self,
        assignment: pb.AssignmentKey,
        problem_id: str,
        step_number: int,
        file_state: pb.WorkspaceFileState.ValueType,
        include_contents: bool,
        include_solution_files: bool,
    ) -> pb.GetWorkspaceResponse:
        return self.call(
            "GetWorkspace",
            self.session.stub.GetWorkspace,
            pb.GetWorkspaceRequest(
                assignment=assignment,
                problem_id=problem_id,
                step_number=step_number,
                file_state=file_state,
                include_contents=include_contents,
                include_solution_files=include_solution_files,
            ),
        )

    def prepare_problem(self, draft: pb.AuthorProblemDraft, action: str) -> pb.PrepareProblemResponse:
        return self.call(
            "PrepareProblem",
            self.session.stub.PrepareProblem,
            pb.PrepareProblemRequest(draft=draft, action=action),
        )

    def save_problem(self, mode: pb.SaveMode.ValueType, bundle: pb.ProblemBundle) -> pb.SaveProblemResponse:
        return self.call("SaveProblem", self.session.stub.SaveProblem, pb.SaveProblemRequest(mode=mode, bundle=bundle))

    def save_problem_set(self, mode: pb.SaveMode.ValueType, bundle: pb.ProblemSetBundle) -> pb.SaveProblemSetResponse:
        return self.call(
            "SaveProblemSet",
            self.session.stub.SaveProblemSet,
            pb.SaveProblemSetRequest(mode=mode, bundle=bundle),
        )

    def save_ungraded_commit(self, commit: pb.GradingCommit) -> pb.SaveUngradedCommitResponse:
        return self.call(
            "SaveUngradedCommit",
            self.session.stub.SaveUngradedCommit,
            pb.SaveUngradedCommitRequest(commit=commit),
        )

    def save_graded_commit(self, bundle: pb.SignedRuntimeBundle) -> pb.SaveGradedCommitResponse:
        return self.call(
            "SaveGradedCommit",
            self.session.stub.SaveGradedCommit,
            pb.SaveGradedCommitRequest(bundle=bundle),
        )
