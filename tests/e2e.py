#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from e2e_common import ARTIFACT_DIR, RUN_ROOT, e2e_env, require, run
from e2e_containment import run_containment_flow
from e2e_flows import (
    run_array_max_flow,
    run_followup_download_checks,
    run_huff_flow,
    run_sudoku_flow,
)
from e2e_setup import (
    build_containers,
    build_rust,
    check_login_argument_shapes,
    check_version_without_config,
    cleanup_success_artifacts,
    create_containment_problem_type,
    create_assignment,
    create_problem_sources,
    create_sudoku_slices,
    ensure_caddy_running,
    delete_assignment,
    ensure_docker_running,
    ensure_server_not_running,
    list_problem_catalog,
    prepare_clean_start,
    rebuild_database,
    run_api_trace_check,
    run_author_catalog_checks,
    run_command_surface_checks,
    run_problem_type_command_checks,
    seed_user_session,
    set_course_roles,
    start_server,
    sync_problem_types,
    wait_for_grind,
    write_grind_config,
    write_server_config,
)


def main() -> int:
    env = e2e_env()
    server = None
    completed = False
    try:
        prepare_clean_start()
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        write_server_config()
        ensure_caddy_running(env)
        ensure_server_not_running(env)
        ensure_docker_running(env)
        build_rust(env)
        env["PATH"] = f"{Path(__file__).resolve().parents[1] / 'target' / 'debug'}:{env['PATH']}"
        check_version_without_config(env)
        check_login_argument_shapes(env)
        build_containers(env)
        rebuild_database(env)
        write_grind_config()
        server = start_server(env)
        seed_user_session()
        wait_for_grind(env)
        run_command_surface_checks(env)
        run_api_trace_check(env)
        sync_problem_types(env)
        create_containment_problem_type(env)
        run_problem_type_command_checks(env)
        create_problem_sources(env)
        create_sudoku_slices(env)
        run_author_catalog_checks(env)
        list_problem_catalog(env)
        set_course_roles("Learner")
        create_assignment("array-max", "Array Max")
        create_assignment("containment", "Daycare Containment")
        run_array_max_flow(env)
        run_containment_flow(env)
        create_assignment("huff", "Huffman Encoder")
        create_assignment("sudoku-1", "Sudoku Pencil Marks 1")
        create_assignment("sudoku-2", "Sudoku Pencil Marks 2")
        create_assignment("sudoku-3", "Sudoku Pencil Marks 3")
        create_assignment("sudoku", "Future Full Sudoku", unlock_at="2099-01-01 00:00:00")
        run_followup_download_checks(env)
        delete_assignment("sudoku")
        run_huff_flow(env)
        run_sudoku_flow(env)
        run(["grind", "list"], env=env)
        completed = True
        print("e2e test completed")
        return 0
    finally:
        if server is not None:
            from e2e_common import stop_process

            stop_process(server)
        if completed:
            cleanup_success_artifacts()
        else:
            print(f"e2e test artifacts left in {RUN_ROOT}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
