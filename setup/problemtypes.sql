INSERT INTO problem_types (problem_type, container) VALUES ('cinout', 'codegrinder/c');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('cinout', 'grade', 'make grade', 'xunit', 60, 100, 10, 512, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('cinout', 'step', 'make step', NULL, 60, 100, 10, 512, 20);

INSERT INTO problem_types (problem_type, container) VALUES ('cppunittest', 'codegrinder/cpp');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'grade', 'make grade', 'xunit', 60, 100, 20, 0, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'valgrind', 'make valgrind', NULL, 60, 100, 20, 0, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('forthinout', 'codegrinder/forth');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'grade', 'make grade', 'xunit', 10, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'step', 'make step', NULL, 10, 100, 10, 256, 50);

INSERT INTO problem_types (problem_type, container) VALUES ('goinout', 'codegrinder/go');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('goinout', 'grade', 'make grade', 'xunit', 10, 200, 20, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('goinout', 'step', 'make step', NULL, 10, 200, 20, 256, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('gounittest', 'codegrinder/go');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('gounittest', 'grade', 'make grade', 'xunit', 10, 200, 10, 256, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('nand2tetris', 'codegrinder/nand2tetris');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('nand2tetris', 'grade', 'make grade', 'xunit', 20, 100, 10, 1024, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('prologinout', 'codegrinder/prolog');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologinout', 'grade', 'make grade', 'xunit', 30, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologinout', 'step', 'make step', NULL, 30, 100, 10, 256, 20);

INSERT INTO problem_types (problem_type, container) VALUES ('prologunittest', 'codegrinder/prolog');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'grade', 'make grade', 'xunit', 10, 100, 10, 256, 20);

INSERT INTO problem_types (problem_type, container) VALUES ('python3inout', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'grade', 'make grade', 'xunit', 120, 100, 100, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'step', 'make step', NULL, 120, 100, 100, 256, 30);

INSERT INTO problem_types (problem_type, container) VALUES ('python3unittest', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'grade', 'make grade', 'xunit', 60, 100, 10, 512, 30);

INSERT INTO problem_types (problem_type, container) VALUES ('rustinout', 'codegrinder/rust');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustinout', 'grade', 'make grade', 'xunit', 30, 100, 20, 1024, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustinout', 'step', 'make step', NULL, 30, 100, 20, 1024, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('riscv', 'codegrinder/riscv');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('riscv', 'grade', 'make grade', 'xunit', 60, 100, 10, 1024, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('riscv', 'step', 'make step', NULL, 60, 100, 10, 1024, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('riscv', 'run', 'make run', NULL, 60, 100, 10, 1024, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('riscv', 'trace', 'make trace', NULL, 60, 100, 10, 1024, 20);

INSERT INTO problem_types (problem_type, container) VALUES ('rustunittest', 'codegrinder/rust');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustunittest', 'grade', 'make grade', 'xunit', 30, 100, 20, 1024, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('sqliteinout', 'codegrinder/sqlite');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('sqliteinout', 'grade', 'make grade', 'xunit', 60, 100, 1000, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('sqliteinout', 'step', 'make step', NULL, 60, 100, 1000, 256, 20);

INSERT INTO problem_types (problem_type, container) VALUES ('standardmlinout', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'grade', 'make grade', 'xunit', 10, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'step', 'make step', NULL, 10, 100, 10, 256, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('standardmlunittest', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'grade', 'make grade', 'xunit', 10, 100, 10, 256, 200);

INSERT INTO problem_types (problem_type, container) VALUES ('typescriptunittest', 'codegrinder/typescript');
INSERT INTO problem_type_actions (problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) VALUES ('typescriptunittest', 'grade', 'make grade', 'xunit', 120, 100, 10, 1024, 50);
