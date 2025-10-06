.PHONY: push
push: .pushed_to_exam

.pushed_to_exam: dist/bundle.js index.html style.css
	rsync -av ./ exam:codegrinder/www/exam/ --delete
	touch .pushed_to_exam

dist/bundle.js: index.js index.html webpack.config.js codegrinder_pb.js codegrinder_grpc_web_pb.js
	./node_modules/.bin/webpack

codegrinder_grpc_web_pb.js: codegrinder.proto
	protoc \
		--js_out=import_style=commonjs,binary:./ \
		--grpc-web_out=import_style=commonjs,mode=grpcweb:./ \
		--proto_path=. \
		codegrinder.proto

codegrinder_pb.js: codegrinder.proto
	protoc \
		--js_out=import_style=commonjs,binary:./ \
		--grpc-web_out=import_style=commonjs,mode=grpcweb:./ \
		--proto_path=. \
		codegrinder.proto
