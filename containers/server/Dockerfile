FROM golang:alpine
RUN apk add --no-cache \
    git
RUN git clone --depth=1 -b cloud https://github.com/russross/codegrinder.git
WORKDIR codegrinder
ENV CODEGRINDERROOT=/codegrinder

RUN go install -tags netgo github.com/russross/codegrinder/server

RUN mkdir -p "$CODEGRINDERROOT"/www
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/cli "$CODEGRINDERROOT"/www/grind.linux_amd64

RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/linux_arm/cli "$CODEGRINDERROOT"/www/grind.linux_arm

RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/linux_arm64/cli "$CODEGRINDERROOT"/www/grind.linux_arm64

RUN CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/linux_riscv64/cli "$CODEGRINDERROOT"/www/grind.linux_riscv64

RUN CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/darwin_amd64/cli "$CODEGRINDERROOT"/www/grind.darwin_amd64

RUN CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/darwin_arm64/cli "$CODEGRINDERROOT"/www/grind.darwin_arm64

RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
RUN mv `go env GOPATH`/bin/windows_amd64/cli.exe "$CODEGRINDERROOT"/www/grind.exe
