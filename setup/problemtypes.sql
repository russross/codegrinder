INSERT INTO problem_types (name, image) VALUES ('cinout', 'codegrinder/c');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cinout', 'step', 'make step', NULL, 'Stepping‥', 0, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cinout', 'valgrind', 'make valgrind', NULL, 'Running valgrind‥', 0, 60, 120, 120, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('cppunittest', 'codegrinder/cpp');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 20, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'valgrind', 'make valgrind', NULL, 'Running valgrind‥', 0, 60, 120, 120, 100, 20, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('forthinout', 'codegrinder/forth');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'step', 'make step', NULL, 'Stepping‥', 0, 10, 1800, 300, 100, 10, 256, 50);

INSERT INTO problem_types (name, image) VALUES ('goinout', 'codegrinder/go');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('goinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 200, 20, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('goinout', 'step', 'make step', NULL, 'Stepping‥', 0, 10, 20, 20, 200, 20, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('gounittest', 'codegrinder/go');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('gounittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 200, 10, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('nand2tetris', 'codegrinder/nand2tetris');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('nand2tetris', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 20, 20, 20, 100, 10, 1024, 200);

INSERT INTO problem_types (name, image) VALUES ('prologinout', 'codegrinder/prolog');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 30, 60, 60, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologinout', 'step', 'make step', NULL, 'Stepping‥', 0, 30, 60, 60, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('prologunittest', 'codegrinder/prolog');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('python3inout', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 120, 120, 120, 100, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'step', 'make step', NULL, 'Stepping‥', 0, 120, 240, 240, 100, 10, 256, 30);

INSERT INTO problem_types (name, image) VALUES ('python3unittest', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 512, 30);

INSERT INTO problem_types (name, image) VALUES ('rustinout', 'codegrinder/rust');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 30, 60, 60, 100, 20, 1024, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustinout', 'step', 'make step', NULL, 'Stepping‥', 0, 30, 60, 60, 100, 20, 1024, 200);

INSERT INTO problem_types (name, image) VALUES ('rustunittest', 'codegrinder/rust');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rustunittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 30, 60, 60, 100, 20, 1024, 200);

INSERT INTO problem_types (name, image) VALUES ('rv64inout', 'codegrinder/riscv');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rv64inout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rv64inout', 'step', 'make step', NULL, 'Stepping‥', 0, 60, 1800, 300, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('rv64sim', 'codegrinder/riscv');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rv64sim', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('rv64sim', 'step', 'make step', NULL, 'Stepping‥', 0, 60, 1800, 300, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('sqliteinout', 'codegrinder/sqlite');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('sqliteinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 1000, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('sqliteinout', 'step', 'make step', NULL, 'Stepping‥', 0, 60, 1800, 300, 100, 1000, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('standardmlinout', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'step', 'make step', NULL, 'Stepping‥', 0, 10, 1800, 300, 100, 10, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('standardmlunittest', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'grade', 'make grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 200);
