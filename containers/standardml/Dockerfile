FROM debian:bookworm

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student

RUN apt update

RUN apt install -y --no-install-recommends \
    make \
    python3
RUN apt install -y --no-install-recommends \
    build-essential \
    gdb
RUN apt install -y --no-install-recommends \
    polyml \
    rlwrap

RUN ln -rsf /usr/lib/aarch64-linux-gnu/libpolyml.so.9.0.0 /usr/lib/aarch64-linux-gnu/libpolyml.so
