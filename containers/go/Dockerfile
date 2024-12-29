FROM arm64v8/alpine:edge

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    icdiff \
    make \
    python3
ENV GODEBUG=installgoroot=all
RUN apk add --no-cache \
    go
RUN go install -a std
