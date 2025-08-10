FROM debian:stable-slim

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apt-get update && apt-get install -y --no-install-recommends \
    make \
    python3 \
    clang \
    clang-tidy \
    libclang-rt-dev \
    && rm -rf /var/lib/apt/lists/*
