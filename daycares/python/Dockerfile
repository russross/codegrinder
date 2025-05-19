FROM codegrinder/server AS server
FROM codegrinder/python AS studentimage

# main container
FROM alpine:latest

# copy codegrinder executable
COPY --from=server /go/bin/server /usr/local/bin/codegrinder

# install gVisor
RUN wget https://storage.googleapis.com/gvisor/releases/release/latest/x86_64/runsc \
        -O /usr/local/bin/runsc && \
    chmod a+rx /usr/local/bin/runsc

# copy the entire student rootfs
RUN mkdir -p /rootfs
COPY --from=studentimage /bin /rootfs/bin
COPY --from=studentimage /usr /rootfs/usr
COPY --from=studentimage /lib /rootfs/lib
COPY --from=studentimage /etc /rootfs/etc
COPY --from=studentimage /var/ /rootfs/var
RUN mkdir -p -m 777 /rootfs/home/student

# run codegrinder daycare
ENV CODEGRINDERROOT /codegrinder
WORKDIR /codegrinder
CMD ["codegrinder", "-daycare"]
