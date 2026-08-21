mod admin;
mod assignment;
mod author;
mod author_config;
mod client;
mod config;
mod daycare;
mod error;
mod files;
mod presentation;
mod proto;
mod student;
mod transcript;
mod version;

use clap::error::ErrorKind;
use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use config::{Roles, load_config_or_default};
use error::{CliError, Result};
use std::env;
use std::ffi::OsString;
use std::process::ExitCode;
use std::time::Duration;
use tokio::runtime::Builder;
use version::CURRENT_VERSION;

#[derive(Debug, Parser)]
#[command(
    name = "grind",
    about = "A command-line tool to access CodeGrinder\nby Russ Ross <russ@russross.com>"
)]
struct Cli {
    #[arg(long, global = true)]
    api: bool,
    #[arg(long, global = true)]
    api_dump: bool,
    #[arg(
        long,
        global = true,
        default_value_t = config::DEFAULT_RPC_TIMEOUT_SECONDS,
        value_parser = clap::value_parser!(u64).range(1..),
        help = "per-RPC timeout in seconds"
    )]
    timeout: u64,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(about = "print the version number of grind")]
    Version,
    #[command(about = "login to codegrinder server")]
    Login(LoginArgs),
    #[command(about = "list all of your active assignments")]
    List(ExtraArgs),
    #[command(about = "download new assignments to the configured workspace root")]
    Get(ExtraArgs),
    #[command(
        about = "save your work, update local problem files, and remove files outside the official workspace set"
    )]
    Sync(ExtraArgs),
    #[command(about = "save your work and submit it for grading")]
    Grade(ExtraArgs),
    #[command(about = "save your work and run an action on the server")]
    Action(ActionArgs),
    #[command(about = "go back to the beginning of the current step for specified files")]
    Reset(ResetArgs),
    #[command(about = "create a new problem/problem set (authors only)")]
    Create(CreateArgs),
    #[command(about = "download a student assignment (instructors only)")]
    Student(SearchArgs),
    #[command(about = "write solution files for the current problem step")]
    Solve(ExtraArgs),
    #[command(about = "find a problem set URL")]
    Problem(SearchArgs),
    #[command(about = "download files for a problem type (authors only)")]
    Type(TypeArgs),
    #[command(about = "manage problem types (admins only)")]
    Problemtype(ProblemTypeArgs),
}

#[derive(Debug, Args)]
struct ExtraArgs {
    extra: Vec<String>,
}

#[derive(Debug, Args)]
struct LoginArgs {
    login_args: Vec<String>,
}

#[derive(Debug, Args)]
struct ActionArgs {
    action_args: Vec<String>,
}

#[derive(Debug, Args)]
struct ResetArgs {
    reset_args: Vec<String>,
}

#[derive(Debug, Args)]
struct SearchArgs {
    search: Vec<String>,
}

#[derive(Debug, Args)]
struct CreateArgs {
    #[arg(short = 'u', long, help = "update an existing problem or problem set")]
    update: bool,
    #[arg(
        short = 'a',
        long,
        default_value = "",
        help = "run one validation action without saving"
    )]
    action: String,
    create_args: Vec<String>,
}

#[derive(Debug, Args)]
struct TypeArgs {
    #[arg(short = 'r', long, help = "remove canonical problem type files")]
    remove: bool,
    #[arg(short = 'l', long, help = "list known problem types and actions")]
    list: bool,
    type_args: Vec<String>,
}

#[derive(Debug, Args)]
struct ProblemTypeArgs {
    #[command(subcommand)]
    command: ProblemTypeCommand,
}

#[derive(Debug, Subcommand)]
enum ProblemTypeCommand {
    #[command(about = "list problem types")]
    List,
    #[command(about = "show one problem type")]
    Show(AdminShowArgs),
    #[command(about = "set problem type actions")]
    Action(AdminActionArgs),
    #[command(about = "push files for a problem type")]
    Files(AdminFilesArgs),
}

#[derive(Debug, Args)]
struct AdminShowArgs {
    #[arg(long = "problem-type", help = "problem type to show")]
    problem_type: String,
}

#[derive(Debug, Args)]
struct AdminActionArgs {
    #[command(subcommand)]
    command: AdminActionCommand,
}

#[derive(Debug, Subcommand)]
enum AdminActionCommand {
    #[command(about = "replace a problem type action list")]
    Set(AdminActionSetArgs),
}

#[derive(Debug, Args)]
struct AdminActionSetArgs {
    #[arg(long = "problem-type", help = "problem type to create or update")]
    problem_type: String,
    #[arg(long, help = "container image used by this problem type")]
    container: String,
    #[arg(
        long = "action",
        help = "NAME|COMMAND|PARSER|MAX_CPU|MAX_FD|MAX_FILE_SIZE|MAX_MEMORY|MAX_THREADS"
    )]
    actions: Vec<String>,
    #[arg(
        long = "actions-file",
        default_value = "",
        help = "file containing action specifications"
    )]
    actions_file: String,
}

#[derive(Debug, Args)]
struct AdminFilesArgs {
    #[arg(
        long = "type",
        default_value = "",
        help = "problem type to compare or replace"
    )]
    problem_type: String,
    #[arg(long = "set", help = "replace the canonical server file set")]
    set_files: bool,
}

fn main() -> ExitCode {
    let runtime = match Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("unexpected error: {error}");
            return ExitCode::from(1);
        }
    };
    match runtime.block_on(run(env::args_os())) {
        Ok(()) => ExitCode::from(0),
        Err(CliError::Silent) => ExitCode::from(1),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

async fn run(argv: impl IntoIterator<Item = OsString>) -> Result<()> {
    let roles = load_config_or_default()
        .map(|config| config.roles)
        .unwrap_or_default();
    let matches = match command_for_roles(roles).try_get_matches_from(argv) {
        Ok(matches) => matches,
        Err(error) => {
            let kind = error.kind();
            error.print()?;
            if matches!(kind, ErrorKind::DisplayHelp | ErrorKind::DisplayVersion) {
                return Ok(());
            }
            return Err(CliError::Silent);
        }
    };
    let cli =
        Cli::from_arg_matches(&matches).map_err(|error| CliError::Message(error.to_string()))?;
    dispatch(cli, roles).await
}

fn command_for_roles(roles: Roles) -> clap::Command {
    let mut command = Cli::command();
    if !roles.is_instructor {
        command = command
            .mut_arg("api", |arg| arg.hide(true))
            .mut_arg("api_dump", |arg| arg.hide(true))
            .mut_arg("timeout", |arg| arg.hide(true));
    }
    if !roles.is_author {
        command = command
            .mut_subcommand("create", |subcommand| subcommand.hide(true))
            .mut_subcommand("type", |subcommand| subcommand.hide(true));
    }
    if !roles.is_instructor {
        command = command.mut_subcommand("student", |subcommand| subcommand.hide(true));
    }
    if !roles.is_author && !roles.is_instructor {
        command = command
            .mut_subcommand("solve", |subcommand| subcommand.hide(true))
            .mut_subcommand("problem", |subcommand| subcommand.hide(true));
    }
    if !roles.is_admin {
        command = command.mut_subcommand("problemtype", |subcommand| subcommand.hide(true));
    }
    command
}

async fn dispatch(cli: Cli, roles: Roles) -> Result<()> {
    let trace =
        config::ApiTrace::with_timeout(cli.api, cli.api_dump, Duration::from_secs(cli.timeout));
    match cli.command {
        None => {
            command_for_roles(roles).print_help()?;
            println!();
            Err(CliError::Silent)
        }
        Some(Command::Version) => {
            println!("grind {CURRENT_VERSION}");
            Ok(())
        }
        Some(Command::Login(args)) => author::command_login(args.login_args, trace).await,
        Some(Command::List(args)) => assignment::command_list(args.extra, trace).await,
        Some(Command::Get(args)) => assignment::command_get(args.extra, trace).await,
        Some(Command::Sync(args)) => student::command_sync(args.extra, trace).await,
        Some(Command::Grade(args)) => student::command_grade(args.extra, trace).await,
        Some(Command::Action(args)) => student::command_action(args.action_args, trace).await,
        Some(Command::Reset(args)) => student::command_reset(args.reset_args, trace).await,
        Some(Command::Create(args)) => {
            author::command_create(args.create_args, args.update, args.action, trace).await
        }
        Some(Command::Student(args)) => author::command_student(args.search, trace).await,
        Some(Command::Solve(args)) => author::command_solve(args.extra, trace).await,
        Some(Command::Problem(args)) => author::command_problem(args.search, trace).await,
        Some(Command::Type(args)) => {
            author::command_type(args.type_args, args.remove, args.list, trace).await
        }
        Some(Command::Problemtype(args)) => match args.command {
            ProblemTypeCommand::List => admin::command_problemtype_list(trace).await,
            ProblemTypeCommand::Show(show) => {
                admin::command_problemtype_show(show.problem_type, trace).await
            }
            ProblemTypeCommand::Action(action) => match action.command {
                AdminActionCommand::Set(set) => {
                    admin::command_problemtype_action_set(
                        set.problem_type,
                        set.container,
                        set.actions,
                        set.actions_file,
                        trace,
                    )
                    .await
                }
            },
            ProblemTypeCommand::Files(files) => {
                admin::command_files(files.problem_type, files.set_files, trace).await
            }
        },
    }
}
