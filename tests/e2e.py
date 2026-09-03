#!/usr/bin/env python3
from __future__ import annotations

import sys

from e2e_common import (
    ARTIFACT_DIR,
    C_STEPS_ID,
    RISC_SINGLE_ID,
    RISC_SLICES_ID,
    ROOT,
    RUN_ROOT,
    SMOKE_PROBLEMS,
    acquire_run_lock,
    e2e_env,
    run,
)
from e2e_flows import (
    run_c_steps_flow,
    run_followup_download_checks,
    run_riscv_single_flow,
    run_riscv_slices_flow,
    run_smoke_problem_flows,
)
from e2e_setup import (
    cleanup_success_artifacts,
    create_assignment,
    create_problem_sources,
    create_riscv_slices,
    delete_assignment,
    install_test_problem_types,
    list_problem_catalog,
    prepare_clean_start,
    purge_test_data,
    remove_test_container,
    run_author_catalog_checks,
    run_problem_type_command_checks,
    seed_user_session,
    set_course_roles,
    validate_prerequisites,
    wait_for_grind,
    write_grind_config,
)


def main() -> int:
    env = e2e_env()
    run_lock = acquire_run_lock()
    cleanup_required = False
    completed = False
    cleanup_error: Exception | None = None
    try:
        validate_prerequisites(env)
        prepare_clean_start(env)
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        cleanup_required = True
        purge_test_data()
        write_grind_config()
        seed_user_session()
        wait_for_grind(env)

        install_test_problem_types(env)
        run_problem_type_command_checks(env)

        preinstalled_riscv_tools = ROOT / "problemtypes" / "containers" / "riscv"
        env["PATH"] = f"{preinstalled_riscv_tools}:{env['PATH']}"
        create_problem_sources(env)
        create_riscv_slices(env)
        run_author_catalog_checks(env)
        list_problem_catalog(env)

        set_course_roles("Learner")
        create_assignment(
            RISC_SINGLE_ID,
            "Test end-to-end RISC-V single-step fixture",
        )
        for smoke in SMOKE_PROBLEMS:
            create_assignment(smoke.problem_id, smoke.title)
        run_riscv_single_flow(env)
        run_smoke_problem_flows(env)

        create_assignment(C_STEPS_ID, "Test end-to-end cumulative C fixture")
        create_assignment(f"{RISC_SLICES_ID}-1", "Test end-to-end RISC-V slice 1")
        create_assignment(f"{RISC_SLICES_ID}-2", "Test end-to-end RISC-V slice 2")
        create_assignment(f"{RISC_SLICES_ID}-3", "Test end-to-end RISC-V slice 3")
        create_assignment(
            RISC_SLICES_ID,
            "Test future-locked RISC-V fixture",
            unlock_at="2099-01-01 00:00:00",
        )
        run_followup_download_checks(env)
        delete_assignment(RISC_SLICES_ID)
        run_c_steps_flow(env)
        run_riscv_slices_flow(env)
        run(["grind", "list"], env=env)
        completed = True
    finally:
        if cleanup_required:
            remove_test_container(env)
            try:
                purge_test_data()
            except Exception as error:
                print(f"failed to purge test database data: {error}", file=sys.stderr)
                cleanup_error = error
                completed = False
        if completed:
            cleanup_success_artifacts()
        elif cleanup_required:
            print(f"e2e test artifacts left in {RUN_ROOT}", file=sys.stderr)
        run_lock.close()
    if cleanup_error is not None:
        raise RuntimeError(
            "e2e test completed but database cleanup failed"
        ) from cleanup_error
    print("e2e test completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"e2e test failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
