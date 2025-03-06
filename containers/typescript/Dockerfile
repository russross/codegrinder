FROM arm64v8/alpine:edge

RUN mkdir /home/student && chmod 777 /home/student
WORKDIR /home/student
RUN apk add --no-cache \
    icdiff
    make
    nodejs
RUN apk add --no-cache \
    npm
RUN npm install -g typescript
RUN npm install \
    jest
    @types/jest
    ts-jest
    ts-node
