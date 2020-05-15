INSERT INTO problem_types (name, image) VALUES ('arm32unittest', 'codegrinder/arm32asm');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm32unittest', 'grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm32unittest', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm32unittest', 'debug', NULL, 'Running gdb‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm32unittest', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm32unittest', 'valgrind', NULL, 'Running valgrind‥', 1, 60, 120, 120, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('arm64unittest', 'codegrinder/arm64asm');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64unittest', 'grade', 'check', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64unittest', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64unittest', 'debug', NULL, 'Running gdb‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64unittest', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64unittest', 'valgrind', NULL, 'Running valgrind‥', 1, 60, 120, 120, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('arm64inout', 'codegrinder/arm64asm');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'step', NULL, 'Stepping‥', 0, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'debug', NULL, 'Running gdb‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('arm64inout', 'valgrind', NULL, 'Running valgrind‥', 1, 60, 120, 120, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('prologunittest', 'codegrinder/prolog');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'test', NULL, 'Testing‥', 0, 10, 20, 20, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'run', NULL, 'Running‥', 1, 10, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('prologunittest', 'shell', NULL, 'Running Prolog shell‥', 1, 10, 1800, 300, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('python3unittest', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 10, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 10, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'stylecheck', NULL, 'Checking pep8 style‥', 0, 60, 120, 120, 10, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'debug', NULL, 'Running debugger‥', 1, 60, 1800, 300, 10, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 10, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3unittest', 'shell', NULL, 'Running Python shell‥', 1, 60, 1800, 300, 10, 10, 256, 30);

INSERT INTO problem_types (name, image) VALUES ('python3inout', 'codegrinder/python');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'step', NULL, 'Stepping‥', 0, 60, 240, 240, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'stylecheck', NULL, 'Checking pep8 style‥', 0, 60, 120, 120, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'debug', NULL, 'Running debugger‥', 1, 60, 1800, 300, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 50, 10, 256, 30);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('python3inout', 'shell', NULL, 'Running Python shell‥', 1, 60, 1800, 300, 50, 10, 256, 30);

INSERT INTO problem_types (name, image) VALUES ('standardmlunittest', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'test', NULL, 'Testing‥', 0, 10, 20, 20, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'run', NULL, 'Running‥', 1, 10, 1800, 300, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlunittest', 'shell', NULL, 'Running PolyML shell‥', 1, 10, 1800, 300, 100, 10, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('standardmlinout', 'codegrinder/standardml');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'test', NULL, 'Testing‥', 0, 10, 20, 20, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'step', NULL, 'Stepping‥', 0, 10, 1800, 300, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'run', NULL, 'Running‥', 1, 10, 1800, 300, 100, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('standardmlinout', 'shell', NULL, 'Running PolyML shell‥', 1, 10, 1800, 300, 100, 10, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('gounittest', 'codegrinder/go');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('gounittest', 'grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 200, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('gounittest', 'test', NULL, 'Testing‥', 0, 10, 20, 20, 200, 10, 256, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('gounittest', 'run', NULL, 'Running‥', 1, 10, 1800, 300, 200, 10, 256, 200);

INSERT INTO problem_types (name, image) VALUES ('cppunittest', 'codegrinder/cpp');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'grade', 'xunit', 'Grading‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'test', NULL, 'Testing‥', 0, 60, 120, 120, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'debug', NULL, 'Running gdb‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'run', NULL, 'Running‥', 1, 60, 1800, 300, 100, 10, 256, 20);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('cppunittest', 'valgrind', NULL, 'Running valgrind‥', 1, 60, 120, 120, 100, 10, 256, 20);

INSERT INTO problem_types (name, image) VALUES ('nand2tetris', 'codegrinder/nand2tetris');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('nand2tetris', 'grade', 'xunit', 'Grading‥', 0, 20, 20, 20, 100, 10, 1024, 200);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('nand2tetris', 'test', NULL, 'Testing‥', 0, 20, 20, 20, 100, 10, 1024, 200);

INSERT INTO problem_types (name, image) VALUES ('forthinout', 'codegrinder/forth');
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'grade', 'xunit', 'Grading‥', 0, 10, 20, 20, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'test', NULL, 'Testing‥', 0, 10, 20, 20, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'step', NULL, 'Stepping‥', 0, 10, 1800, 300, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'run', NULL, 'Running‥', 1, 10, 1800, 300, 100, 10, 256, 50);
INSERT INTO problem_type_actions (problem_type, action, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) VALUES ('forthinout', 'shell', NULL, 'Running gforth shell‥', 1, 10, 1800, 300, 100, 10, 256, 50);
