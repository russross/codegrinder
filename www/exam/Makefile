.PHONY: push
push: .pushed_to_exam

.pushed_to_exam: dist/bundle.js index.html style.css
	rsync -av ./ exam:codegrinder/www/exam/ --delete
	touch .pushed_to_exam

dist/bundle.js: index.js index.html webpack.config.js codegrinder_pb.js codegrinder_grpc_web_pb.js
	./node_modules/.bin/webpack
