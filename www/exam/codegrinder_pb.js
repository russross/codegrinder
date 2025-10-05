// source: codegrinder.proto
/**
 * @fileoverview
 * @enhanceable
 * @suppress {missingRequire} reports error on implicit type usages.
 * @suppress {messageConventions} JS Compiler reports an error if a variable or
 *     field starts with 'MSG_' and isn't a translatable message.
 * @public
 */
// GENERATED CODE -- DO NOT EDIT!
/* eslint-disable */
// @ts-nocheck

var jspb = require('google-protobuf');
var goog = jspb;
var global =
    (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof window !== 'undefined' && window) ||
    (typeof global !== 'undefined' && global) ||
    (typeof self !== 'undefined' && self) ||
    (function () { return this; }).call(null) ||
    Function('return this')();

var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
goog.object.extend(proto, google_protobuf_timestamp_pb);
var google_protobuf_duration_pb = require('google-protobuf/google/protobuf/duration_pb.js');
goog.object.extend(proto, google_protobuf_duration_pb);
goog.exportSymbol('proto.codegrinder.Assignment', null, global);
goog.exportSymbol('proto.codegrinder.Commit', null, global);
goog.exportSymbol('proto.codegrinder.CommitBundle', null, global);
goog.exportSymbol('proto.codegrinder.Course', null, global);
goog.exportSymbol('proto.codegrinder.DaycareRequest', null, global);
goog.exportSymbol('proto.codegrinder.DaycareResponse', null, global);
goog.exportSymbol('proto.codegrinder.DaycareResponse.ResponseCase', null, global);
goog.exportSymbol('proto.codegrinder.EventMessage', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentProblemCommitLastRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentProblemCommitLastResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentProblemStepCommitLastRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentProblemStepCommitLastResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetAssignmentsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseUserAssignmentsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseUserAssignmentsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseUsersRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetCourseUsersResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetCoursesRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetCoursesResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetProblemsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetProblemsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemSetsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemStepRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemStepResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemStepsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemStepsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemTypeRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemTypeResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemTypesRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemTypesResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetProblemsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetUserAssignmentsRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetUserAssignmentsResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetUserMeRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetUserMeResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetUserRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetUserResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetUsersRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetUsersResponse', null, global);
goog.exportSymbol('proto.codegrinder.GetVersionRequest', null, global);
goog.exportSymbol('proto.codegrinder.GetVersionResponse', null, global);
goog.exportSymbol('proto.codegrinder.ListProblemsRequest', null, global);
goog.exportSymbol('proto.codegrinder.ListProblemsResponse', null, global);
goog.exportSymbol('proto.codegrinder.PostCommitBundlesSignedRequest', null, global);
goog.exportSymbol('proto.codegrinder.PostCommitBundlesSignedResponse', null, global);
goog.exportSymbol('proto.codegrinder.PostCommitBundlesUnsignedRequest', null, global);
goog.exportSymbol('proto.codegrinder.PostCommitBundlesUnsignedResponse', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemBundleConfirmedRequest', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemBundleConfirmedResponse', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemBundleUnconfirmedRequest', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemBundleUnconfirmedResponse', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemSetBundleRequest', null, global);
goog.exportSymbol('proto.codegrinder.PostProblemSetBundleResponse', null, global);
goog.exportSymbol('proto.codegrinder.Problem', null, global);
goog.exportSymbol('proto.codegrinder.ProblemBundle', null, global);
goog.exportSymbol('proto.codegrinder.ProblemSet', null, global);
goog.exportSymbol('proto.codegrinder.ProblemSetBundle', null, global);
goog.exportSymbol('proto.codegrinder.ProblemSetProblem', null, global);
goog.exportSymbol('proto.codegrinder.ProblemStep', null, global);
goog.exportSymbol('proto.codegrinder.ProblemType', null, global);
goog.exportSymbol('proto.codegrinder.ProblemTypeAction', null, global);
goog.exportSymbol('proto.codegrinder.PutProblemBundleRequest', null, global);
goog.exportSymbol('proto.codegrinder.PutProblemBundleResponse', null, global);
goog.exportSymbol('proto.codegrinder.PutProblemSetBundleRequest', null, global);
goog.exportSymbol('proto.codegrinder.PutProblemSetBundleResponse', null, global);
goog.exportSymbol('proto.codegrinder.ReportCard', null, global);
goog.exportSymbol('proto.codegrinder.ReportCardResult', null, global);
goog.exportSymbol('proto.codegrinder.ScoreList', null, global);
goog.exportSymbol('proto.codegrinder.User', null, global);
goog.exportSymbol('proto.codegrinder.Version', null, global);
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.User = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.User, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.User.displayName = 'proto.codegrinder.User';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.Course = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.Course, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.Course.displayName = 'proto.codegrinder.Course';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ScoreList = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ScoreList.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ScoreList, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ScoreList.displayName = 'proto.codegrinder.ScoreList';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.Assignment = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.Assignment, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.Assignment.displayName = 'proto.codegrinder.Assignment';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemSet = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ProblemSet.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ProblemSet, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemSet.displayName = 'proto.codegrinder.ProblemSet';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemType = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ProblemType, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemType.displayName = 'proto.codegrinder.ProblemType';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemTypeAction = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ProblemTypeAction, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemTypeAction.displayName = 'proto.codegrinder.ProblemTypeAction';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.Problem = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.Problem.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.Problem, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.Problem.displayName = 'proto.codegrinder.Problem';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemStep = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ProblemStep, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemStep.displayName = 'proto.codegrinder.ProblemStep';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemSetProblem = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ProblemSetProblem, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemSetProblem.displayName = 'proto.codegrinder.ProblemSetProblem';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ReportCard = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ReportCard.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ReportCard, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ReportCard.displayName = 'proto.codegrinder.ReportCard';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ReportCardResult = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ReportCardResult, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ReportCardResult.displayName = 'proto.codegrinder.ReportCardResult';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.EventMessage = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.EventMessage.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.EventMessage, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.EventMessage.displayName = 'proto.codegrinder.EventMessage';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.Commit = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.Commit.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.Commit, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.Commit.displayName = 'proto.codegrinder.Commit';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemBundle = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ProblemBundle.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ProblemBundle, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemBundle.displayName = 'proto.codegrinder.ProblemBundle';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ProblemSetBundle = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ProblemSetBundle.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ProblemSetBundle, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ProblemSetBundle.displayName = 'proto.codegrinder.ProblemSetBundle';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.CommitBundle = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.CommitBundle.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.CommitBundle, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.CommitBundle.displayName = 'proto.codegrinder.CommitBundle';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.DaycareRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.DaycareRequest.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.DaycareRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.DaycareRequest.displayName = 'proto.codegrinder.DaycareRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.DaycareResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, proto.codegrinder.DaycareResponse.oneofGroups_);
};
goog.inherits(proto.codegrinder.DaycareResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.DaycareResponse.displayName = 'proto.codegrinder.DaycareResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.Version = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.Version, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.Version.displayName = 'proto.codegrinder.Version';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ListProblemsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.ListProblemsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ListProblemsRequest.displayName = 'proto.codegrinder.ListProblemsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.ListProblemsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.ListProblemsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.ListProblemsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.ListProblemsResponse.displayName = 'proto.codegrinder.ListProblemsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetVersionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetVersionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetVersionRequest.displayName = 'proto.codegrinder.GetVersionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetVersionResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetVersionResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetVersionResponse.displayName = 'proto.codegrinder.GetVersionResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemTypesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemTypesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemTypesRequest.displayName = 'proto.codegrinder.GetProblemTypesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemTypesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemTypesResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemTypesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemTypesResponse.displayName = 'proto.codegrinder.GetProblemTypesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemTypeRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemTypeRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemTypeRequest.displayName = 'proto.codegrinder.GetProblemTypeRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemTypeResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemTypeResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemTypeResponse.displayName = 'proto.codegrinder.GetProblemTypeResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemsRequest.displayName = 'proto.codegrinder.GetProblemsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemsResponse.displayName = 'proto.codegrinder.GetProblemsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemRequest.displayName = 'proto.codegrinder.GetProblemRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemResponse.displayName = 'proto.codegrinder.GetProblemResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemStepsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemStepsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemStepsRequest.displayName = 'proto.codegrinder.GetProblemStepsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemStepsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemStepsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemStepsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemStepsResponse.displayName = 'proto.codegrinder.GetProblemStepsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemStepRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemStepRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemStepRequest.displayName = 'proto.codegrinder.GetProblemStepRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemStepResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemStepResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemStepResponse.displayName = 'proto.codegrinder.GetProblemStepResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemSetsRequest.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemSetsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetsRequest.displayName = 'proto.codegrinder.GetProblemSetsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemSetsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemSetsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetsResponse.displayName = 'proto.codegrinder.GetProblemSetsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetRequest.displayName = 'proto.codegrinder.GetProblemSetRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemSetResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetResponse.displayName = 'proto.codegrinder.GetProblemSetResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetProblemsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetProblemSetProblemsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetProblemsRequest.displayName = 'proto.codegrinder.GetProblemSetProblemsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetProblemSetProblemsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetProblemSetProblemsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetProblemSetProblemsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetProblemSetProblemsResponse.displayName = 'proto.codegrinder.GetProblemSetProblemsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCoursesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetCoursesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCoursesRequest.displayName = 'proto.codegrinder.GetCoursesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCoursesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetCoursesResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetCoursesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCoursesResponse.displayName = 'proto.codegrinder.GetCoursesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetCourseRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseRequest.displayName = 'proto.codegrinder.GetCourseRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetCourseResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseResponse.displayName = 'proto.codegrinder.GetCourseResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUsersRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUsersRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUsersRequest.displayName = 'proto.codegrinder.GetUsersRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUsersResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetUsersResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetUsersResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUsersResponse.displayName = 'proto.codegrinder.GetUsersResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserMeRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUserMeRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserMeRequest.displayName = 'proto.codegrinder.GetUserMeRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserMeResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUserMeResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserMeResponse.displayName = 'proto.codegrinder.GetUserMeResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUserRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserRequest.displayName = 'proto.codegrinder.GetUserRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUserResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserResponse.displayName = 'proto.codegrinder.GetUserResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseUsersRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetCourseUsersRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseUsersRequest.displayName = 'proto.codegrinder.GetCourseUsersRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseUsersResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetCourseUsersResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetCourseUsersResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseUsersResponse.displayName = 'proto.codegrinder.GetCourseUsersResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserAssignmentsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetUserAssignmentsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserAssignmentsRequest.displayName = 'proto.codegrinder.GetUserAssignmentsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetUserAssignmentsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetUserAssignmentsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetUserAssignmentsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetUserAssignmentsResponse.displayName = 'proto.codegrinder.GetUserAssignmentsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseUserAssignmentsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetCourseUserAssignmentsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseUserAssignmentsRequest.displayName = 'proto.codegrinder.GetCourseUserAssignmentsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetCourseUserAssignmentsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetCourseUserAssignmentsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetCourseUserAssignmentsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetCourseUserAssignmentsResponse.displayName = 'proto.codegrinder.GetCourseUserAssignmentsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetAssignmentsRequest.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetAssignmentsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentsRequest.displayName = 'proto.codegrinder.GetAssignmentsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.codegrinder.GetAssignmentsResponse.repeatedFields_, null);
};
goog.inherits(proto.codegrinder.GetAssignmentsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentsResponse.displayName = 'proto.codegrinder.GetAssignmentsResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentRequest.displayName = 'proto.codegrinder.GetAssignmentRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentResponse.displayName = 'proto.codegrinder.GetAssignmentResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentProblemCommitLastRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentProblemCommitLastRequest.displayName = 'proto.codegrinder.GetAssignmentProblemCommitLastRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentProblemCommitLastResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentProblemCommitLastResponse.displayName = 'proto.codegrinder.GetAssignmentProblemCommitLastResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentProblemStepCommitLastRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.displayName = 'proto.codegrinder.GetAssignmentProblemStepCommitLastRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.GetAssignmentProblemStepCommitLastResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.displayName = 'proto.codegrinder.GetAssignmentProblemStepCommitLastResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemBundleUnconfirmedRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemBundleUnconfirmedRequest.displayName = 'proto.codegrinder.PostProblemBundleUnconfirmedRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemBundleUnconfirmedResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemBundleUnconfirmedResponse.displayName = 'proto.codegrinder.PostProblemBundleUnconfirmedResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemBundleConfirmedRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemBundleConfirmedRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemBundleConfirmedRequest.displayName = 'proto.codegrinder.PostProblemBundleConfirmedRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemBundleConfirmedResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemBundleConfirmedResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemBundleConfirmedResponse.displayName = 'proto.codegrinder.PostProblemBundleConfirmedResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PutProblemBundleRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PutProblemBundleRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PutProblemBundleRequest.displayName = 'proto.codegrinder.PutProblemBundleRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PutProblemBundleResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PutProblemBundleResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PutProblemBundleResponse.displayName = 'proto.codegrinder.PutProblemBundleResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemSetBundleRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemSetBundleRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemSetBundleRequest.displayName = 'proto.codegrinder.PostProblemSetBundleRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostProblemSetBundleResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostProblemSetBundleResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostProblemSetBundleResponse.displayName = 'proto.codegrinder.PostProblemSetBundleResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PutProblemSetBundleRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PutProblemSetBundleRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PutProblemSetBundleRequest.displayName = 'proto.codegrinder.PutProblemSetBundleRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PutProblemSetBundleResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PutProblemSetBundleResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PutProblemSetBundleResponse.displayName = 'proto.codegrinder.PutProblemSetBundleResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostCommitBundlesUnsignedRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostCommitBundlesUnsignedRequest.displayName = 'proto.codegrinder.PostCommitBundlesUnsignedRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostCommitBundlesUnsignedResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostCommitBundlesUnsignedResponse.displayName = 'proto.codegrinder.PostCommitBundlesUnsignedResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostCommitBundlesSignedRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostCommitBundlesSignedRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostCommitBundlesSignedRequest.displayName = 'proto.codegrinder.PostCommitBundlesSignedRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.codegrinder.PostCommitBundlesSignedResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.codegrinder.PostCommitBundlesSignedResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.codegrinder.PostCommitBundlesSignedResponse.displayName = 'proto.codegrinder.PostCommitBundlesSignedResponse';
}



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.User.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.User.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.User} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.User.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
name: jspb.Message.getFieldWithDefault(msg, 2, ""),
email: jspb.Message.getFieldWithDefault(msg, 3, ""),
ltiId: jspb.Message.getFieldWithDefault(msg, 4, ""),
imageUrl: jspb.Message.getFieldWithDefault(msg, 5, ""),
canvasLogin: jspb.Message.getFieldWithDefault(msg, 6, ""),
canvasId: jspb.Message.getFieldWithDefault(msg, 7, 0),
author: jspb.Message.getBooleanFieldWithDefault(msg, 8, false),
admin: jspb.Message.getBooleanFieldWithDefault(msg, 9, false),
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
lastSignedInAt: (f = msg.getLastSignedInAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.User}
 */
proto.codegrinder.User.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.User;
  return proto.codegrinder.User.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.User} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.User}
 */
proto.codegrinder.User.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setEmail(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setLtiId(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setImageUrl(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setCanvasLogin(value);
      break;
    case 7:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCanvasId(value);
      break;
    case 8:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setAuthor(value);
      break;
    case 9:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setAdmin(value);
      break;
    case 10:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 11:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    case 12:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setLastSignedInAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.User.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.User.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.User} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.User.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getEmail();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getLtiId();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getImageUrl();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getCanvasLogin();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getCanvasId();
  if (f !== 0) {
    writer.writeInt64(
      7,
      f
    );
  }
  f = message.getAuthor();
  if (f) {
    writer.writeBool(
      8,
      f
    );
  }
  f = message.getAdmin();
  if (f) {
    writer.writeBool(
      9,
      f
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      10,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      11,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getLastSignedInAt();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.User.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional string name = 2;
 * @return {string}
 */
proto.codegrinder.User.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string email = 3;
 * @return {string}
 */
proto.codegrinder.User.prototype.getEmail = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setEmail = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string lti_id = 4;
 * @return {string}
 */
proto.codegrinder.User.prototype.getLtiId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setLtiId = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string image_url = 5;
 * @return {string}
 */
proto.codegrinder.User.prototype.getImageUrl = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setImageUrl = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string canvas_login = 6;
 * @return {string}
 */
proto.codegrinder.User.prototype.getCanvasLogin = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setCanvasLogin = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional int64 canvas_id = 7;
 * @return {number}
 */
proto.codegrinder.User.prototype.getCanvasId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 7, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setCanvasId = function(value) {
  return jspb.Message.setProto3IntField(this, 7, value);
};


/**
 * optional bool author = 8;
 * @return {boolean}
 */
proto.codegrinder.User.prototype.getAuthor = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 8, false));
};


/**
 * @param {boolean} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setAuthor = function(value) {
  return jspb.Message.setProto3BooleanField(this, 8, value);
};


/**
 * optional bool admin = 9;
 * @return {boolean}
 */
proto.codegrinder.User.prototype.getAdmin = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 9, false));
};


/**
 * @param {boolean} value
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.setAdmin = function(value) {
  return jspb.Message.setProto3BooleanField(this, 9, value);
};


/**
 * optional google.protobuf.Timestamp created_at = 10;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.User.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 10));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.User} returns this
*/
proto.codegrinder.User.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 10, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.User.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 10) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 11;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.User.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 11));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.User} returns this
*/
proto.codegrinder.User.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 11, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.User.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 11) != null;
};


/**
 * optional google.protobuf.Timestamp last_signed_in_at = 12;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.User.prototype.getLastSignedInAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 12));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.User} returns this
*/
proto.codegrinder.User.prototype.setLastSignedInAt = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.User} returns this
 */
proto.codegrinder.User.prototype.clearLastSignedInAt = function() {
  return this.setLastSignedInAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.User.prototype.hasLastSignedInAt = function() {
  return jspb.Message.getField(this, 12) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.Course.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.Course.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.Course} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Course.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
name: jspb.Message.getFieldWithDefault(msg, 2, ""),
label: jspb.Message.getFieldWithDefault(msg, 3, ""),
ltiId: jspb.Message.getFieldWithDefault(msg, 4, ""),
canvasId: jspb.Message.getFieldWithDefault(msg, 5, 0),
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.Course}
 */
proto.codegrinder.Course.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.Course;
  return proto.codegrinder.Course.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.Course} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.Course}
 */
proto.codegrinder.Course.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setLabel(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setLtiId(value);
      break;
    case 5:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCanvasId(value);
      break;
    case 6:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 7:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.Course.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.Course.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.Course} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Course.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getLabel();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getLtiId();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getCanvasId();
  if (f !== 0) {
    writer.writeInt64(
      5,
      f
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.Course.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional string name = 2;
 * @return {string}
 */
proto.codegrinder.Course.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string label = 3;
 * @return {string}
 */
proto.codegrinder.Course.prototype.getLabel = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.setLabel = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string lti_id = 4;
 * @return {string}
 */
proto.codegrinder.Course.prototype.getLtiId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.setLtiId = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional int64 canvas_id = 5;
 * @return {number}
 */
proto.codegrinder.Course.prototype.getCanvasId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 5, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.setCanvasId = function(value) {
  return jspb.Message.setProto3IntField(this, 5, value);
};


/**
 * optional google.protobuf.Timestamp created_at = 6;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Course.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 6));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Course} returns this
*/
proto.codegrinder.Course.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Course.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 7;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Course.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 7));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Course} returns this
*/
proto.codegrinder.Course.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Course} returns this
 */
proto.codegrinder.Course.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Course.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 7) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ScoreList.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ScoreList.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ScoreList.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ScoreList} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ScoreList.toObject = function(includeInstance, msg) {
  var f, obj = {
scoresList: (f = jspb.Message.getRepeatedFloatingPointField(msg, 1)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ScoreList}
 */
proto.codegrinder.ScoreList.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ScoreList;
  return proto.codegrinder.ScoreList.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ScoreList} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ScoreList}
 */
proto.codegrinder.ScoreList.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var values = /** @type {!Array<number>} */ (reader.isDelimited() ? reader.readPackedDouble() : [reader.readDouble()]);
      for (var i = 0; i < values.length; i++) {
        msg.addScores(values[i]);
      }
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ScoreList.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ScoreList.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ScoreList} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ScoreList.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getScoresList();
  if (f.length > 0) {
    writer.writePackedDouble(
      1,
      f
    );
  }
};


/**
 * repeated double scores = 1;
 * @return {!Array<number>}
 */
proto.codegrinder.ScoreList.prototype.getScoresList = function() {
  return /** @type {!Array<number>} */ (jspb.Message.getRepeatedFloatingPointField(this, 1));
};


/**
 * @param {!Array<number>} value
 * @return {!proto.codegrinder.ScoreList} returns this
 */
proto.codegrinder.ScoreList.prototype.setScoresList = function(value) {
  return jspb.Message.setField(this, 1, value || []);
};


/**
 * @param {number} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ScoreList} returns this
 */
proto.codegrinder.ScoreList.prototype.addScores = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 1, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ScoreList} returns this
 */
proto.codegrinder.ScoreList.prototype.clearScoresList = function() {
  return this.setScoresList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.Assignment.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.Assignment.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.Assignment} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Assignment.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
courseId: jspb.Message.getFieldWithDefault(msg, 2, 0),
problemSetId: jspb.Message.getFieldWithDefault(msg, 3, 0),
userId: jspb.Message.getFieldWithDefault(msg, 4, 0),
roles: jspb.Message.getFieldWithDefault(msg, 5, ""),
instructor: jspb.Message.getBooleanFieldWithDefault(msg, 6, false),
rawScoresMap: (f = msg.getRawScoresMap()) ? f.toObject(includeInstance, proto.codegrinder.ScoreList.toObject) : [],
score: jspb.Message.getFloatingPointFieldWithDefault(msg, 8, 0.0),
gradeId: jspb.Message.getFieldWithDefault(msg, 9, ""),
ltiId: jspb.Message.getFieldWithDefault(msg, 10, ""),
canvasTitle: jspb.Message.getFieldWithDefault(msg, 11, ""),
canvasId: jspb.Message.getFieldWithDefault(msg, 12, 0),
canvasApiDomain: jspb.Message.getFieldWithDefault(msg, 13, ""),
outcomeUrl: jspb.Message.getFieldWithDefault(msg, 14, ""),
outcomeExtUrl: jspb.Message.getFieldWithDefault(msg, 15, ""),
outcomeExtAccepted: jspb.Message.getFieldWithDefault(msg, 16, ""),
finishedUrl: jspb.Message.getFieldWithDefault(msg, 17, ""),
consumerKey: jspb.Message.getFieldWithDefault(msg, 18, ""),
unlockAt: (f = msg.getUnlockAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
dueAt: (f = msg.getDueAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
lockAt: (f = msg.getLockAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.Assignment.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.Assignment;
  return proto.codegrinder.Assignment.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.Assignment} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.Assignment.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCourseId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemSetId(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setRoles(value);
      break;
    case 6:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setInstructor(value);
      break;
    case 7:
      var value = msg.getRawScoresMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readMessage, proto.codegrinder.ScoreList.deserializeBinaryFromReader, "", new proto.codegrinder.ScoreList());
         });
      break;
    case 8:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setScore(value);
      break;
    case 9:
      var value = /** @type {string} */ (reader.readString());
      msg.setGradeId(value);
      break;
    case 10:
      var value = /** @type {string} */ (reader.readString());
      msg.setLtiId(value);
      break;
    case 11:
      var value = /** @type {string} */ (reader.readString());
      msg.setCanvasTitle(value);
      break;
    case 12:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCanvasId(value);
      break;
    case 13:
      var value = /** @type {string} */ (reader.readString());
      msg.setCanvasApiDomain(value);
      break;
    case 14:
      var value = /** @type {string} */ (reader.readString());
      msg.setOutcomeUrl(value);
      break;
    case 15:
      var value = /** @type {string} */ (reader.readString());
      msg.setOutcomeExtUrl(value);
      break;
    case 16:
      var value = /** @type {string} */ (reader.readString());
      msg.setOutcomeExtAccepted(value);
      break;
    case 17:
      var value = /** @type {string} */ (reader.readString());
      msg.setFinishedUrl(value);
      break;
    case 18:
      var value = /** @type {string} */ (reader.readString());
      msg.setConsumerKey(value);
      break;
    case 19:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUnlockAt(value);
      break;
    case 20:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setDueAt(value);
      break;
    case 21:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setLockAt(value);
      break;
    case 22:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 23:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.Assignment.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.Assignment.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.Assignment} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Assignment.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getCourseId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getProblemSetId();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      4,
      f
    );
  }
  f = message.getRoles();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getInstructor();
  if (f) {
    writer.writeBool(
      6,
      f
    );
  }
  f = message.getRawScoresMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(7, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeMessage, proto.codegrinder.ScoreList.serializeBinaryToWriter);
  }
  f = message.getScore();
  if (f !== 0.0) {
    writer.writeDouble(
      8,
      f
    );
  }
  f = message.getGradeId();
  if (f.length > 0) {
    writer.writeString(
      9,
      f
    );
  }
  f = message.getLtiId();
  if (f.length > 0) {
    writer.writeString(
      10,
      f
    );
  }
  f = message.getCanvasTitle();
  if (f.length > 0) {
    writer.writeString(
      11,
      f
    );
  }
  f = message.getCanvasId();
  if (f !== 0) {
    writer.writeInt64(
      12,
      f
    );
  }
  f = message.getCanvasApiDomain();
  if (f.length > 0) {
    writer.writeString(
      13,
      f
    );
  }
  f = message.getOutcomeUrl();
  if (f.length > 0) {
    writer.writeString(
      14,
      f
    );
  }
  f = message.getOutcomeExtUrl();
  if (f.length > 0) {
    writer.writeString(
      15,
      f
    );
  }
  f = message.getOutcomeExtAccepted();
  if (f.length > 0) {
    writer.writeString(
      16,
      f
    );
  }
  f = message.getFinishedUrl();
  if (f.length > 0) {
    writer.writeString(
      17,
      f
    );
  }
  f = message.getConsumerKey();
  if (f.length > 0) {
    writer.writeString(
      18,
      f
    );
  }
  f = message.getUnlockAt();
  if (f != null) {
    writer.writeMessage(
      19,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getDueAt();
  if (f != null) {
    writer.writeMessage(
      20,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getLockAt();
  if (f != null) {
    writer.writeMessage(
      21,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      22,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      23,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional int64 course_id = 2;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getCourseId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setCourseId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 problem_set_id = 3;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getProblemSetId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setProblemSetId = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};


/**
 * optional int64 user_id = 4;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};


/**
 * optional string roles = 5;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getRoles = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setRoles = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional bool instructor = 6;
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.getInstructor = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 6, false));
};


/**
 * @param {boolean} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setInstructor = function(value) {
  return jspb.Message.setProto3BooleanField(this, 6, value);
};


/**
 * map<string, ScoreList> raw_scores = 7;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!proto.codegrinder.ScoreList>}
 */
proto.codegrinder.Assignment.prototype.getRawScoresMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!proto.codegrinder.ScoreList>} */ (
      jspb.Message.getMapField(this, 7, opt_noLazyCreate,
      proto.codegrinder.ScoreList));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearRawScoresMap = function() {
  this.getRawScoresMap().clear();
  return this;
};


/**
 * optional double score = 8;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getScore = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 8, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setScore = function(value) {
  return jspb.Message.setProto3FloatField(this, 8, value);
};


/**
 * optional string grade_id = 9;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getGradeId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 9, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setGradeId = function(value) {
  return jspb.Message.setProto3StringField(this, 9, value);
};


/**
 * optional string lti_id = 10;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getLtiId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 10, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setLtiId = function(value) {
  return jspb.Message.setProto3StringField(this, 10, value);
};


/**
 * optional string canvas_title = 11;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getCanvasTitle = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 11, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setCanvasTitle = function(value) {
  return jspb.Message.setProto3StringField(this, 11, value);
};


/**
 * optional int64 canvas_id = 12;
 * @return {number}
 */
proto.codegrinder.Assignment.prototype.getCanvasId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 12, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setCanvasId = function(value) {
  return jspb.Message.setProto3IntField(this, 12, value);
};


/**
 * optional string canvas_api_domain = 13;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getCanvasApiDomain = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 13, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setCanvasApiDomain = function(value) {
  return jspb.Message.setProto3StringField(this, 13, value);
};


/**
 * optional string outcome_url = 14;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getOutcomeUrl = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 14, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setOutcomeUrl = function(value) {
  return jspb.Message.setProto3StringField(this, 14, value);
};


/**
 * optional string outcome_ext_url = 15;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getOutcomeExtUrl = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 15, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setOutcomeExtUrl = function(value) {
  return jspb.Message.setProto3StringField(this, 15, value);
};


/**
 * optional string outcome_ext_accepted = 16;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getOutcomeExtAccepted = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 16, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setOutcomeExtAccepted = function(value) {
  return jspb.Message.setProto3StringField(this, 16, value);
};


/**
 * optional string finished_url = 17;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getFinishedUrl = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 17, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setFinishedUrl = function(value) {
  return jspb.Message.setProto3StringField(this, 17, value);
};


/**
 * optional string consumer_key = 18;
 * @return {string}
 */
proto.codegrinder.Assignment.prototype.getConsumerKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 18, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.setConsumerKey = function(value) {
  return jspb.Message.setProto3StringField(this, 18, value);
};


/**
 * optional google.protobuf.Timestamp unlock_at = 19;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Assignment.prototype.getUnlockAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 19));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Assignment} returns this
*/
proto.codegrinder.Assignment.prototype.setUnlockAt = function(value) {
  return jspb.Message.setWrapperField(this, 19, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearUnlockAt = function() {
  return this.setUnlockAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.hasUnlockAt = function() {
  return jspb.Message.getField(this, 19) != null;
};


/**
 * optional google.protobuf.Timestamp due_at = 20;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Assignment.prototype.getDueAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 20));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Assignment} returns this
*/
proto.codegrinder.Assignment.prototype.setDueAt = function(value) {
  return jspb.Message.setWrapperField(this, 20, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearDueAt = function() {
  return this.setDueAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.hasDueAt = function() {
  return jspb.Message.getField(this, 20) != null;
};


/**
 * optional google.protobuf.Timestamp lock_at = 21;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Assignment.prototype.getLockAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 21));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Assignment} returns this
*/
proto.codegrinder.Assignment.prototype.setLockAt = function(value) {
  return jspb.Message.setWrapperField(this, 21, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearLockAt = function() {
  return this.setLockAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.hasLockAt = function() {
  return jspb.Message.getField(this, 21) != null;
};


/**
 * optional google.protobuf.Timestamp created_at = 22;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Assignment.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 22));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Assignment} returns this
*/
proto.codegrinder.Assignment.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 22, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 22) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 23;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Assignment.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 23));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Assignment} returns this
*/
proto.codegrinder.Assignment.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 23, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Assignment} returns this
 */
proto.codegrinder.Assignment.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Assignment.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 23) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ProblemSet.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemSet.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemSet.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemSet} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSet.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
unique: jspb.Message.getFieldWithDefault(msg, 2, ""),
note: jspb.Message.getFieldWithDefault(msg, 3, ""),
tagsList: (f = jspb.Message.getRepeatedField(msg, 4)) == null ? undefined : f,
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemSet}
 */
proto.codegrinder.ProblemSet.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemSet;
  return proto.codegrinder.ProblemSet.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemSet} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemSet}
 */
proto.codegrinder.ProblemSet.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setUnique(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.addTags(value);
      break;
    case 5:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 6:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemSet.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemSet.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemSet} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSet.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getUnique();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getTagsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      4,
      f
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.ProblemSet.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional string unique = 2;
 * @return {string}
 */
proto.codegrinder.ProblemSet.prototype.getUnique = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.setUnique = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string note = 3;
 * @return {string}
 */
proto.codegrinder.ProblemSet.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * repeated string tags = 4;
 * @return {!Array<string>}
 */
proto.codegrinder.ProblemSet.prototype.getTagsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 4));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.setTagsList = function(value) {
  return jspb.Message.setField(this, 4, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.addTags = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 4, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.clearTagsList = function() {
  return this.setTagsList([]);
};


/**
 * optional google.protobuf.Timestamp created_at = 5;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.ProblemSet.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 5));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.ProblemSet} returns this
*/
proto.codegrinder.ProblemSet.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ProblemSet.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 6;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.ProblemSet.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 6));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.ProblemSet} returns this
*/
proto.codegrinder.ProblemSet.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ProblemSet} returns this
 */
proto.codegrinder.ProblemSet.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ProblemSet.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 6) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemType.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemType.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemType} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemType.toObject = function(includeInstance, msg) {
  var f, obj = {
name: jspb.Message.getFieldWithDefault(msg, 1, ""),
image: jspb.Message.getFieldWithDefault(msg, 2, ""),
filesMap: (f = msg.getFilesMap()) ? f.toObject(includeInstance, undefined) : [],
actionsMap: (f = msg.getActionsMap()) ? f.toObject(includeInstance, proto.codegrinder.ProblemTypeAction.toObject) : []
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemType}
 */
proto.codegrinder.ProblemType.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemType;
  return proto.codegrinder.ProblemType.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemType} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemType}
 */
proto.codegrinder.ProblemType.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setImage(value);
      break;
    case 3:
      var value = msg.getFilesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBytes, null, "", "");
         });
      break;
    case 4:
      var value = msg.getActionsMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readMessage, proto.codegrinder.ProblemTypeAction.deserializeBinaryFromReader, "", new proto.codegrinder.ProblemTypeAction());
         });
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemType.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemType.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemType} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemType.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getImage();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getFilesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(3, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBytes);
  }
  f = message.getActionsMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(4, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeMessage, proto.codegrinder.ProblemTypeAction.serializeBinaryToWriter);
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.codegrinder.ProblemType.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemType} returns this
 */
proto.codegrinder.ProblemType.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string image = 2;
 * @return {string}
 */
proto.codegrinder.ProblemType.prototype.getImage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemType} returns this
 */
proto.codegrinder.ProblemType.prototype.setImage = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * map<string, bytes> files = 3;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!(string|Uint8Array)>}
 */
proto.codegrinder.ProblemType.prototype.getFilesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!(string|Uint8Array)>} */ (
      jspb.Message.getMapField(this, 3, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemType} returns this
 */
proto.codegrinder.ProblemType.prototype.clearFilesMap = function() {
  this.getFilesMap().clear();
  return this;
};


/**
 * map<string, ProblemTypeAction> actions = 4;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!proto.codegrinder.ProblemTypeAction>}
 */
proto.codegrinder.ProblemType.prototype.getActionsMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!proto.codegrinder.ProblemTypeAction>} */ (
      jspb.Message.getMapField(this, 4, opt_noLazyCreate,
      proto.codegrinder.ProblemTypeAction));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemType} returns this
 */
proto.codegrinder.ProblemType.prototype.clearActionsMap = function() {
  this.getActionsMap().clear();
  return this;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemTypeAction.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemTypeAction.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemTypeAction} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemTypeAction.toObject = function(includeInstance, msg) {
  var f, obj = {
problemType: jspb.Message.getFieldWithDefault(msg, 1, ""),
action: jspb.Message.getFieldWithDefault(msg, 2, ""),
command: jspb.Message.getFieldWithDefault(msg, 3, ""),
parser: jspb.Message.getFieldWithDefault(msg, 4, ""),
message: jspb.Message.getFieldWithDefault(msg, 5, ""),
interactive: jspb.Message.getBooleanFieldWithDefault(msg, 6, false),
maxCpu: jspb.Message.getFieldWithDefault(msg, 7, 0),
maxSession: jspb.Message.getFieldWithDefault(msg, 8, 0),
maxTimeout: jspb.Message.getFieldWithDefault(msg, 9, 0),
maxFd: jspb.Message.getFieldWithDefault(msg, 10, 0),
maxFileSize: jspb.Message.getFieldWithDefault(msg, 11, 0),
maxMemory: jspb.Message.getFieldWithDefault(msg, 12, 0),
maxThreads: jspb.Message.getFieldWithDefault(msg, 13, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemTypeAction}
 */
proto.codegrinder.ProblemTypeAction.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemTypeAction;
  return proto.codegrinder.ProblemTypeAction.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemTypeAction} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemTypeAction}
 */
proto.codegrinder.ProblemTypeAction.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemType(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setAction(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setCommand(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setParser(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setMessage(value);
      break;
    case 6:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setInteractive(value);
      break;
    case 7:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxCpu(value);
      break;
    case 8:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxSession(value);
      break;
    case 9:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxTimeout(value);
      break;
    case 10:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxFd(value);
      break;
    case 11:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxFileSize(value);
      break;
    case 12:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxMemory(value);
      break;
    case 13:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setMaxThreads(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemTypeAction.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemTypeAction.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemTypeAction} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemTypeAction.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemType();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getAction();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getCommand();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getParser();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getMessage();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getInteractive();
  if (f) {
    writer.writeBool(
      6,
      f
    );
  }
  f = message.getMaxCpu();
  if (f !== 0) {
    writer.writeInt64(
      7,
      f
    );
  }
  f = message.getMaxSession();
  if (f !== 0) {
    writer.writeInt64(
      8,
      f
    );
  }
  f = message.getMaxTimeout();
  if (f !== 0) {
    writer.writeInt64(
      9,
      f
    );
  }
  f = message.getMaxFd();
  if (f !== 0) {
    writer.writeInt64(
      10,
      f
    );
  }
  f = message.getMaxFileSize();
  if (f !== 0) {
    writer.writeInt64(
      11,
      f
    );
  }
  f = message.getMaxMemory();
  if (f !== 0) {
    writer.writeInt64(
      12,
      f
    );
  }
  f = message.getMaxThreads();
  if (f !== 0) {
    writer.writeInt64(
      13,
      f
    );
  }
};


/**
 * optional string problem_type = 1;
 * @return {string}
 */
proto.codegrinder.ProblemTypeAction.prototype.getProblemType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setProblemType = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string action = 2;
 * @return {string}
 */
proto.codegrinder.ProblemTypeAction.prototype.getAction = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setAction = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string command = 3;
 * @return {string}
 */
proto.codegrinder.ProblemTypeAction.prototype.getCommand = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setCommand = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string parser = 4;
 * @return {string}
 */
proto.codegrinder.ProblemTypeAction.prototype.getParser = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setParser = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string message = 5;
 * @return {string}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMessage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMessage = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional bool interactive = 6;
 * @return {boolean}
 */
proto.codegrinder.ProblemTypeAction.prototype.getInteractive = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 6, false));
};


/**
 * @param {boolean} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setInteractive = function(value) {
  return jspb.Message.setProto3BooleanField(this, 6, value);
};


/**
 * optional int64 max_cpu = 7;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxCpu = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 7, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxCpu = function(value) {
  return jspb.Message.setProto3IntField(this, 7, value);
};


/**
 * optional int64 max_session = 8;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxSession = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 8, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxSession = function(value) {
  return jspb.Message.setProto3IntField(this, 8, value);
};


/**
 * optional int64 max_timeout = 9;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxTimeout = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 9, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxTimeout = function(value) {
  return jspb.Message.setProto3IntField(this, 9, value);
};


/**
 * optional int64 max_fd = 10;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxFd = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 10, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxFd = function(value) {
  return jspb.Message.setProto3IntField(this, 10, value);
};


/**
 * optional int64 max_file_size = 11;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxFileSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 11, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxFileSize = function(value) {
  return jspb.Message.setProto3IntField(this, 11, value);
};


/**
 * optional int64 max_memory = 12;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxMemory = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 12, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxMemory = function(value) {
  return jspb.Message.setProto3IntField(this, 12, value);
};


/**
 * optional int64 max_threads = 13;
 * @return {number}
 */
proto.codegrinder.ProblemTypeAction.prototype.getMaxThreads = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 13, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemTypeAction} returns this
 */
proto.codegrinder.ProblemTypeAction.prototype.setMaxThreads = function(value) {
  return jspb.Message.setProto3IntField(this, 13, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.Problem.repeatedFields_ = [4,5];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.Problem.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.Problem.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.Problem} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Problem.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
unique: jspb.Message.getFieldWithDefault(msg, 2, ""),
note: jspb.Message.getFieldWithDefault(msg, 3, ""),
tagsList: (f = jspb.Message.getRepeatedField(msg, 4)) == null ? undefined : f,
optionsList: (f = jspb.Message.getRepeatedField(msg, 5)) == null ? undefined : f,
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.Problem}
 */
proto.codegrinder.Problem.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.Problem;
  return proto.codegrinder.Problem.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.Problem} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.Problem}
 */
proto.codegrinder.Problem.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setUnique(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.addTags(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.addOptions(value);
      break;
    case 6:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 7:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.Problem.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.Problem.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.Problem} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Problem.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getUnique();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getTagsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      4,
      f
    );
  }
  f = message.getOptionsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      5,
      f
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.Problem.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional string unique = 2;
 * @return {string}
 */
proto.codegrinder.Problem.prototype.getUnique = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.setUnique = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string note = 3;
 * @return {string}
 */
proto.codegrinder.Problem.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * repeated string tags = 4;
 * @return {!Array<string>}
 */
proto.codegrinder.Problem.prototype.getTagsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 4));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.setTagsList = function(value) {
  return jspb.Message.setField(this, 4, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.addTags = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 4, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.clearTagsList = function() {
  return this.setTagsList([]);
};


/**
 * repeated string options = 5;
 * @return {!Array<string>}
 */
proto.codegrinder.Problem.prototype.getOptionsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 5));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.setOptionsList = function(value) {
  return jspb.Message.setField(this, 5, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.addOptions = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 5, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.clearOptionsList = function() {
  return this.setOptionsList([]);
};


/**
 * optional google.protobuf.Timestamp created_at = 6;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Problem.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 6));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Problem} returns this
*/
proto.codegrinder.Problem.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Problem.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 7;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Problem.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 7));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Problem} returns this
*/
proto.codegrinder.Problem.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Problem} returns this
 */
proto.codegrinder.Problem.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Problem.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 7) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemStep.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemStep.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemStep} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemStep.toObject = function(includeInstance, msg) {
  var f, obj = {
problemId: jspb.Message.getFieldWithDefault(msg, 1, 0),
step: jspb.Message.getFieldWithDefault(msg, 2, 0),
problemType: jspb.Message.getFieldWithDefault(msg, 3, ""),
note: jspb.Message.getFieldWithDefault(msg, 4, ""),
instructions: jspb.Message.getFieldWithDefault(msg, 5, ""),
weight: jspb.Message.getFloatingPointFieldWithDefault(msg, 6, 0.0),
filesMap: (f = msg.getFilesMap()) ? f.toObject(includeInstance, undefined) : [],
whitelistMap: (f = msg.getWhitelistMap()) ? f.toObject(includeInstance, undefined) : [],
solutionMap: (f = msg.getSolutionMap()) ? f.toObject(includeInstance, undefined) : []
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemStep}
 */
proto.codegrinder.ProblemStep.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemStep;
  return proto.codegrinder.ProblemStep.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemStep} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemStep}
 */
proto.codegrinder.ProblemStep.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setStep(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemType(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setInstructions(value);
      break;
    case 6:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setWeight(value);
      break;
    case 7:
      var value = msg.getFilesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBytes, null, "", "");
         });
      break;
    case 8:
      var value = msg.getWhitelistMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBool, null, "", false);
         });
      break;
    case 9:
      var value = msg.getSolutionMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBytes, null, "", "");
         });
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemStep.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemStep.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemStep} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemStep.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getStep();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getProblemType();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getInstructions();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getWeight();
  if (f !== 0.0) {
    writer.writeDouble(
      6,
      f
    );
  }
  f = message.getFilesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(7, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBytes);
  }
  f = message.getWhitelistMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(8, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBool);
  }
  f = message.getSolutionMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(9, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBytes);
  }
};


/**
 * optional int64 problem_id = 1;
 * @return {number}
 */
proto.codegrinder.ProblemStep.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional int64 step = 2;
 * @return {number}
 */
proto.codegrinder.ProblemStep.prototype.getStep = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setStep = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string problem_type = 3;
 * @return {string}
 */
proto.codegrinder.ProblemStep.prototype.getProblemType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setProblemType = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string note = 4;
 * @return {string}
 */
proto.codegrinder.ProblemStep.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string instructions = 5;
 * @return {string}
 */
proto.codegrinder.ProblemStep.prototype.getInstructions = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setInstructions = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional double weight = 6;
 * @return {number}
 */
proto.codegrinder.ProblemStep.prototype.getWeight = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 6, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.setWeight = function(value) {
  return jspb.Message.setProto3FloatField(this, 6, value);
};


/**
 * map<string, bytes> files = 7;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!(string|Uint8Array)>}
 */
proto.codegrinder.ProblemStep.prototype.getFilesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!(string|Uint8Array)>} */ (
      jspb.Message.getMapField(this, 7, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.clearFilesMap = function() {
  this.getFilesMap().clear();
  return this;
};


/**
 * map<string, bool> whitelist = 8;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,boolean>}
 */
proto.codegrinder.ProblemStep.prototype.getWhitelistMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,boolean>} */ (
      jspb.Message.getMapField(this, 8, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.clearWhitelistMap = function() {
  this.getWhitelistMap().clear();
  return this;
};


/**
 * map<string, bytes> solution = 9;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!(string|Uint8Array)>}
 */
proto.codegrinder.ProblemStep.prototype.getSolutionMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!(string|Uint8Array)>} */ (
      jspb.Message.getMapField(this, 9, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemStep} returns this
 */
proto.codegrinder.ProblemStep.prototype.clearSolutionMap = function() {
  this.getSolutionMap().clear();
  return this;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemSetProblem.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemSetProblem.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemSetProblem} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSetProblem.toObject = function(includeInstance, msg) {
  var f, obj = {
problemSetId: jspb.Message.getFieldWithDefault(msg, 1, 0),
problemId: jspb.Message.getFieldWithDefault(msg, 2, 0),
weight: jspb.Message.getFloatingPointFieldWithDefault(msg, 3, 0.0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemSetProblem}
 */
proto.codegrinder.ProblemSetProblem.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemSetProblem;
  return proto.codegrinder.ProblemSetProblem.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemSetProblem} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemSetProblem}
 */
proto.codegrinder.ProblemSetProblem.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemSetId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setWeight(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemSetProblem.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemSetProblem.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemSetProblem} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSetProblem.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemSetId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getWeight();
  if (f !== 0.0) {
    writer.writeDouble(
      3,
      f
    );
  }
};


/**
 * optional int64 problem_set_id = 1;
 * @return {number}
 */
proto.codegrinder.ProblemSetProblem.prototype.getProblemSetId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemSetProblem} returns this
 */
proto.codegrinder.ProblemSetProblem.prototype.setProblemSetId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional int64 problem_id = 2;
 * @return {number}
 */
proto.codegrinder.ProblemSetProblem.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemSetProblem} returns this
 */
proto.codegrinder.ProblemSetProblem.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional double weight = 3;
 * @return {number}
 */
proto.codegrinder.ProblemSetProblem.prototype.getWeight = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 3, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemSetProblem} returns this
 */
proto.codegrinder.ProblemSetProblem.prototype.setWeight = function(value) {
  return jspb.Message.setProto3FloatField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ReportCard.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ReportCard.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ReportCard.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ReportCard} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ReportCard.toObject = function(includeInstance, msg) {
  var f, obj = {
passed: jspb.Message.getBooleanFieldWithDefault(msg, 1, false),
note: jspb.Message.getFieldWithDefault(msg, 2, ""),
duration: (f = msg.getDuration()) && google_protobuf_duration_pb.Duration.toObject(includeInstance, f),
resultsList: jspb.Message.toObjectList(msg.getResultsList(),
    proto.codegrinder.ReportCardResult.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ReportCard}
 */
proto.codegrinder.ReportCard.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ReportCard;
  return proto.codegrinder.ReportCard.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ReportCard} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ReportCard}
 */
proto.codegrinder.ReportCard.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setPassed(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 3:
      var value = new google_protobuf_duration_pb.Duration;
      reader.readMessage(value,google_protobuf_duration_pb.Duration.deserializeBinaryFromReader);
      msg.setDuration(value);
      break;
    case 4:
      var value = new proto.codegrinder.ReportCardResult;
      reader.readMessage(value,proto.codegrinder.ReportCardResult.deserializeBinaryFromReader);
      msg.addResults(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ReportCard.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ReportCard.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ReportCard} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ReportCard.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getPassed();
  if (f) {
    writer.writeBool(
      1,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getDuration();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_duration_pb.Duration.serializeBinaryToWriter
    );
  }
  f = message.getResultsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.codegrinder.ReportCardResult.serializeBinaryToWriter
    );
  }
};


/**
 * optional bool passed = 1;
 * @return {boolean}
 */
proto.codegrinder.ReportCard.prototype.getPassed = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 1, false));
};


/**
 * @param {boolean} value
 * @return {!proto.codegrinder.ReportCard} returns this
 */
proto.codegrinder.ReportCard.prototype.setPassed = function(value) {
  return jspb.Message.setProto3BooleanField(this, 1, value);
};


/**
 * optional string note = 2;
 * @return {string}
 */
proto.codegrinder.ReportCard.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ReportCard} returns this
 */
proto.codegrinder.ReportCard.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Duration duration = 3;
 * @return {?proto.google.protobuf.Duration}
 */
proto.codegrinder.ReportCard.prototype.getDuration = function() {
  return /** @type{?proto.google.protobuf.Duration} */ (
    jspb.Message.getWrapperField(this, google_protobuf_duration_pb.Duration, 3));
};


/**
 * @param {?proto.google.protobuf.Duration|undefined} value
 * @return {!proto.codegrinder.ReportCard} returns this
*/
proto.codegrinder.ReportCard.prototype.setDuration = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ReportCard} returns this
 */
proto.codegrinder.ReportCard.prototype.clearDuration = function() {
  return this.setDuration(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ReportCard.prototype.hasDuration = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * repeated ReportCardResult results = 4;
 * @return {!Array<!proto.codegrinder.ReportCardResult>}
 */
proto.codegrinder.ReportCard.prototype.getResultsList = function() {
  return /** @type{!Array<!proto.codegrinder.ReportCardResult>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ReportCardResult, 4));
};


/**
 * @param {!Array<!proto.codegrinder.ReportCardResult>} value
 * @return {!proto.codegrinder.ReportCard} returns this
*/
proto.codegrinder.ReportCard.prototype.setResultsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.codegrinder.ReportCardResult=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ReportCardResult}
 */
proto.codegrinder.ReportCard.prototype.addResults = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.codegrinder.ReportCardResult, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ReportCard} returns this
 */
proto.codegrinder.ReportCard.prototype.clearResultsList = function() {
  return this.setResultsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ReportCardResult.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ReportCardResult.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ReportCardResult} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ReportCardResult.toObject = function(includeInstance, msg) {
  var f, obj = {
name: jspb.Message.getFieldWithDefault(msg, 1, ""),
outcome: jspb.Message.getFieldWithDefault(msg, 2, ""),
details: jspb.Message.getFieldWithDefault(msg, 3, ""),
context: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ReportCardResult}
 */
proto.codegrinder.ReportCardResult.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ReportCardResult;
  return proto.codegrinder.ReportCardResult.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ReportCardResult} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ReportCardResult}
 */
proto.codegrinder.ReportCardResult.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setOutcome(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setDetails(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setContext(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ReportCardResult.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ReportCardResult.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ReportCardResult} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ReportCardResult.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getOutcome();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getDetails();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getContext();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.codegrinder.ReportCardResult.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ReportCardResult} returns this
 */
proto.codegrinder.ReportCardResult.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string outcome = 2;
 * @return {string}
 */
proto.codegrinder.ReportCardResult.prototype.getOutcome = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ReportCardResult} returns this
 */
proto.codegrinder.ReportCardResult.prototype.setOutcome = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string details = 3;
 * @return {string}
 */
proto.codegrinder.ReportCardResult.prototype.getDetails = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ReportCardResult} returns this
 */
proto.codegrinder.ReportCardResult.prototype.setDetails = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string context = 4;
 * @return {string}
 */
proto.codegrinder.ReportCardResult.prototype.getContext = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ReportCardResult} returns this
 */
proto.codegrinder.ReportCardResult.prototype.setContext = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.EventMessage.repeatedFields_ = [3];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.EventMessage.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.EventMessage.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.EventMessage} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.EventMessage.toObject = function(includeInstance, msg) {
  var f, obj = {
time: (f = msg.getTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
event: jspb.Message.getFieldWithDefault(msg, 2, ""),
execCommandList: (f = jspb.Message.getRepeatedField(msg, 3)) == null ? undefined : f,
exitStatus: jspb.Message.getFieldWithDefault(msg, 4, 0),
streamData: msg.getStreamData_asB64(),
error: jspb.Message.getFieldWithDefault(msg, 6, ""),
reportCard: (f = msg.getReportCard()) && proto.codegrinder.ReportCard.toObject(includeInstance, f),
filesMap: (f = msg.getFilesMap()) ? f.toObject(includeInstance, undefined) : []
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.EventMessage}
 */
proto.codegrinder.EventMessage.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.EventMessage;
  return proto.codegrinder.EventMessage.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.EventMessage} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.EventMessage}
 */
proto.codegrinder.EventMessage.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setTime(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setEvent(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.addExecCommand(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setExitStatus(value);
      break;
    case 5:
      var value = /** @type {!Uint8Array} */ (reader.readBytes());
      msg.setStreamData(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setError(value);
      break;
    case 7:
      var value = new proto.codegrinder.ReportCard;
      reader.readMessage(value,proto.codegrinder.ReportCard.deserializeBinaryFromReader);
      msg.setReportCard(value);
      break;
    case 8:
      var value = msg.getFilesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBytes, null, "", "");
         });
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.EventMessage.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.EventMessage.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.EventMessage} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.EventMessage.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getTime();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getEvent();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getExecCommandList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      3,
      f
    );
  }
  f = message.getExitStatus();
  if (f !== 0) {
    writer.writeInt32(
      4,
      f
    );
  }
  f = message.getStreamData_asU8();
  if (f.length > 0) {
    writer.writeBytes(
      5,
      f
    );
  }
  f = message.getError();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getReportCard();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      proto.codegrinder.ReportCard.serializeBinaryToWriter
    );
  }
  f = message.getFilesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(8, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBytes);
  }
};


/**
 * optional google.protobuf.Timestamp time = 1;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.EventMessage.prototype.getTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 1));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.EventMessage} returns this
*/
proto.codegrinder.EventMessage.prototype.setTime = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.clearTime = function() {
  return this.setTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.EventMessage.prototype.hasTime = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string event = 2;
 * @return {string}
 */
proto.codegrinder.EventMessage.prototype.getEvent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.setEvent = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * repeated string exec_command = 3;
 * @return {!Array<string>}
 */
proto.codegrinder.EventMessage.prototype.getExecCommandList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 3));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.setExecCommandList = function(value) {
  return jspb.Message.setField(this, 3, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.addExecCommand = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 3, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.clearExecCommandList = function() {
  return this.setExecCommandList([]);
};


/**
 * optional int32 exit_status = 4;
 * @return {number}
 */
proto.codegrinder.EventMessage.prototype.getExitStatus = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.setExitStatus = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};


/**
 * optional bytes stream_data = 5;
 * @return {!(string|Uint8Array)}
 */
proto.codegrinder.EventMessage.prototype.getStreamData = function() {
  return /** @type {!(string|Uint8Array)} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * optional bytes stream_data = 5;
 * This is a type-conversion wrapper around `getStreamData()`
 * @return {string}
 */
proto.codegrinder.EventMessage.prototype.getStreamData_asB64 = function() {
  return /** @type {string} */ (jspb.Message.bytesAsB64(
      this.getStreamData()));
};


/**
 * optional bytes stream_data = 5;
 * Note that Uint8Array is not supported on all browsers.
 * @see http://caniuse.com/Uint8Array
 * This is a type-conversion wrapper around `getStreamData()`
 * @return {!Uint8Array}
 */
proto.codegrinder.EventMessage.prototype.getStreamData_asU8 = function() {
  return /** @type {!Uint8Array} */ (jspb.Message.bytesAsU8(
      this.getStreamData()));
};


/**
 * @param {!(string|Uint8Array)} value
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.setStreamData = function(value) {
  return jspb.Message.setProto3BytesField(this, 5, value);
};


/**
 * optional string error = 6;
 * @return {string}
 */
proto.codegrinder.EventMessage.prototype.getError = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.setError = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional ReportCard report_card = 7;
 * @return {?proto.codegrinder.ReportCard}
 */
proto.codegrinder.EventMessage.prototype.getReportCard = function() {
  return /** @type{?proto.codegrinder.ReportCard} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ReportCard, 7));
};


/**
 * @param {?proto.codegrinder.ReportCard|undefined} value
 * @return {!proto.codegrinder.EventMessage} returns this
*/
proto.codegrinder.EventMessage.prototype.setReportCard = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.clearReportCard = function() {
  return this.setReportCard(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.EventMessage.prototype.hasReportCard = function() {
  return jspb.Message.getField(this, 7) != null;
};


/**
 * map<string, bytes> files = 8;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!(string|Uint8Array)>}
 */
proto.codegrinder.EventMessage.prototype.getFilesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!(string|Uint8Array)>} */ (
      jspb.Message.getMapField(this, 8, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.EventMessage} returns this
 */
proto.codegrinder.EventMessage.prototype.clearFilesMap = function() {
  this.getFilesMap().clear();
  return this;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.Commit.repeatedFields_ = [8];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.Commit.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.Commit.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.Commit} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Commit.toObject = function(includeInstance, msg) {
  var f, obj = {
id: jspb.Message.getFieldWithDefault(msg, 1, 0),
assignmentId: jspb.Message.getFieldWithDefault(msg, 2, 0),
problemId: jspb.Message.getFieldWithDefault(msg, 3, 0),
step: jspb.Message.getFieldWithDefault(msg, 4, 0),
action: jspb.Message.getFieldWithDefault(msg, 5, ""),
note: jspb.Message.getFieldWithDefault(msg, 6, ""),
filesMap: (f = msg.getFilesMap()) ? f.toObject(includeInstance, undefined) : [],
transcriptList: jspb.Message.toObjectList(msg.getTranscriptList(),
    proto.codegrinder.EventMessage.toObject, includeInstance),
reportCard: (f = msg.getReportCard()) && proto.codegrinder.ReportCard.toObject(includeInstance, f),
score: jspb.Message.getFloatingPointFieldWithDefault(msg, 10, 0.0),
createdAt: (f = msg.getCreatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
updatedAt: (f = msg.getUpdatedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.Commit}
 */
proto.codegrinder.Commit.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.Commit;
  return proto.codegrinder.Commit.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.Commit} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.Commit}
 */
proto.codegrinder.Commit.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setAssignmentId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setStep(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setAction(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 7:
      var value = msg.getFilesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readBytes, null, "", "");
         });
      break;
    case 8:
      var value = new proto.codegrinder.EventMessage;
      reader.readMessage(value,proto.codegrinder.EventMessage.deserializeBinaryFromReader);
      msg.addTranscript(value);
      break;
    case 9:
      var value = new proto.codegrinder.ReportCard;
      reader.readMessage(value,proto.codegrinder.ReportCard.deserializeBinaryFromReader);
      msg.setReportCard(value);
      break;
    case 10:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setScore(value);
      break;
    case 11:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreatedAt(value);
      break;
    case 12:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdatedAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.Commit.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.Commit.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.Commit} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Commit.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getId();
  if (f !== 0) {
    writer.writeInt64(
      1,
      f
    );
  }
  f = message.getAssignmentId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
  f = message.getStep();
  if (f !== 0) {
    writer.writeInt64(
      4,
      f
    );
  }
  f = message.getAction();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getFilesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(7, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeBytes);
  }
  f = message.getTranscriptList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      8,
      f,
      proto.codegrinder.EventMessage.serializeBinaryToWriter
    );
  }
  f = message.getReportCard();
  if (f != null) {
    writer.writeMessage(
      9,
      f,
      proto.codegrinder.ReportCard.serializeBinaryToWriter
    );
  }
  f = message.getScore();
  if (f !== 0.0) {
    writer.writeDouble(
      10,
      f
    );
  }
  f = message.getCreatedAt();
  if (f != null) {
    writer.writeMessage(
      11,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdatedAt();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional int64 id = 1;
 * @return {number}
 */
proto.codegrinder.Commit.prototype.getId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setId = function(value) {
  return jspb.Message.setProto3IntField(this, 1, value);
};


/**
 * optional int64 assignment_id = 2;
 * @return {number}
 */
proto.codegrinder.Commit.prototype.getAssignmentId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setAssignmentId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 problem_id = 3;
 * @return {number}
 */
proto.codegrinder.Commit.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};


/**
 * optional int64 step = 4;
 * @return {number}
 */
proto.codegrinder.Commit.prototype.getStep = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setStep = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};


/**
 * optional string action = 5;
 * @return {string}
 */
proto.codegrinder.Commit.prototype.getAction = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setAction = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string note = 6;
 * @return {string}
 */
proto.codegrinder.Commit.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * map<string, bytes> files = 7;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!(string|Uint8Array)>}
 */
proto.codegrinder.Commit.prototype.getFilesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!(string|Uint8Array)>} */ (
      jspb.Message.getMapField(this, 7, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.clearFilesMap = function() {
  this.getFilesMap().clear();
  return this;
};


/**
 * repeated EventMessage transcript = 8;
 * @return {!Array<!proto.codegrinder.EventMessage>}
 */
proto.codegrinder.Commit.prototype.getTranscriptList = function() {
  return /** @type{!Array<!proto.codegrinder.EventMessage>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.EventMessage, 8));
};


/**
 * @param {!Array<!proto.codegrinder.EventMessage>} value
 * @return {!proto.codegrinder.Commit} returns this
*/
proto.codegrinder.Commit.prototype.setTranscriptList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 8, value);
};


/**
 * @param {!proto.codegrinder.EventMessage=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.EventMessage}
 */
proto.codegrinder.Commit.prototype.addTranscript = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 8, opt_value, proto.codegrinder.EventMessage, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.clearTranscriptList = function() {
  return this.setTranscriptList([]);
};


/**
 * optional ReportCard report_card = 9;
 * @return {?proto.codegrinder.ReportCard}
 */
proto.codegrinder.Commit.prototype.getReportCard = function() {
  return /** @type{?proto.codegrinder.ReportCard} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ReportCard, 9));
};


/**
 * @param {?proto.codegrinder.ReportCard|undefined} value
 * @return {!proto.codegrinder.Commit} returns this
*/
proto.codegrinder.Commit.prototype.setReportCard = function(value) {
  return jspb.Message.setWrapperField(this, 9, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.clearReportCard = function() {
  return this.setReportCard(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Commit.prototype.hasReportCard = function() {
  return jspb.Message.getField(this, 9) != null;
};


/**
 * optional double score = 10;
 * @return {number}
 */
proto.codegrinder.Commit.prototype.getScore = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 10, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.setScore = function(value) {
  return jspb.Message.setProto3FloatField(this, 10, value);
};


/**
 * optional google.protobuf.Timestamp created_at = 11;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Commit.prototype.getCreatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 11));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Commit} returns this
*/
proto.codegrinder.Commit.prototype.setCreatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 11, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.clearCreatedAt = function() {
  return this.setCreatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Commit.prototype.hasCreatedAt = function() {
  return jspb.Message.getField(this, 11) != null;
};


/**
 * optional google.protobuf.Timestamp updated_at = 12;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.codegrinder.Commit.prototype.getUpdatedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 12));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.codegrinder.Commit} returns this
*/
proto.codegrinder.Commit.prototype.setUpdatedAt = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.Commit} returns this
 */
proto.codegrinder.Commit.prototype.clearUpdatedAt = function() {
  return this.setUpdatedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.Commit.prototype.hasUpdatedAt = function() {
  return jspb.Message.getField(this, 12) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ProblemBundle.repeatedFields_ = [4,8,9];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemBundle.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemBundle.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemBundle} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemBundle.toObject = function(includeInstance, msg) {
  var f, obj = {
problemTypesMap: (f = msg.getProblemTypesMap()) ? f.toObject(includeInstance, proto.codegrinder.ProblemType.toObject) : [],
problemTypeSignaturesMap: (f = msg.getProblemTypeSignaturesMap()) ? f.toObject(includeInstance, undefined) : [],
problem: (f = msg.getProblem()) && proto.codegrinder.Problem.toObject(includeInstance, f),
problemStepsList: jspb.Message.toObjectList(msg.getProblemStepsList(),
    proto.codegrinder.ProblemStep.toObject, includeInstance),
problemSignature: jspb.Message.getFieldWithDefault(msg, 5, ""),
hostname: jspb.Message.getFieldWithDefault(msg, 6, ""),
userId: jspb.Message.getFieldWithDefault(msg, 7, 0),
commitsList: jspb.Message.toObjectList(msg.getCommitsList(),
    proto.codegrinder.Commit.toObject, includeInstance),
commitSignaturesList: (f = jspb.Message.getRepeatedField(msg, 9)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.ProblemBundle.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemBundle;
  return proto.codegrinder.ProblemBundle.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemBundle} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.ProblemBundle.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = msg.getProblemTypesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readMessage, proto.codegrinder.ProblemType.deserializeBinaryFromReader, "", new proto.codegrinder.ProblemType());
         });
      break;
    case 2:
      var value = msg.getProblemTypeSignaturesMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readString, null, "", "");
         });
      break;
    case 3:
      var value = new proto.codegrinder.Problem;
      reader.readMessage(value,proto.codegrinder.Problem.deserializeBinaryFromReader);
      msg.setProblem(value);
      break;
    case 4:
      var value = new proto.codegrinder.ProblemStep;
      reader.readMessage(value,proto.codegrinder.ProblemStep.deserializeBinaryFromReader);
      msg.addProblemSteps(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemSignature(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setHostname(value);
      break;
    case 7:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    case 8:
      var value = new proto.codegrinder.Commit;
      reader.readMessage(value,proto.codegrinder.Commit.deserializeBinaryFromReader);
      msg.addCommits(value);
      break;
    case 9:
      var value = /** @type {string} */ (reader.readString());
      msg.addCommitSignatures(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemBundle.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemBundle.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemBundle} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemBundle.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemTypesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(1, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeMessage, proto.codegrinder.ProblemType.serializeBinaryToWriter);
  }
  f = message.getProblemTypeSignaturesMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(2, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeString);
  }
  f = message.getProblem();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.codegrinder.Problem.serializeBinaryToWriter
    );
  }
  f = message.getProblemStepsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.codegrinder.ProblemStep.serializeBinaryToWriter
    );
  }
  f = message.getProblemSignature();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getHostname();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      7,
      f
    );
  }
  f = message.getCommitsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      8,
      f,
      proto.codegrinder.Commit.serializeBinaryToWriter
    );
  }
  f = message.getCommitSignaturesList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      9,
      f
    );
  }
};


/**
 * map<string, ProblemType> problem_types = 1;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,!proto.codegrinder.ProblemType>}
 */
proto.codegrinder.ProblemBundle.prototype.getProblemTypesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,!proto.codegrinder.ProblemType>} */ (
      jspb.Message.getMapField(this, 1, opt_noLazyCreate,
      proto.codegrinder.ProblemType));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearProblemTypesMap = function() {
  this.getProblemTypesMap().clear();
  return this;
};


/**
 * map<string, string> problem_type_signatures = 2;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,string>}
 */
proto.codegrinder.ProblemBundle.prototype.getProblemTypeSignaturesMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,string>} */ (
      jspb.Message.getMapField(this, 2, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearProblemTypeSignaturesMap = function() {
  this.getProblemTypeSignaturesMap().clear();
  return this;
};


/**
 * optional Problem problem = 3;
 * @return {?proto.codegrinder.Problem}
 */
proto.codegrinder.ProblemBundle.prototype.getProblem = function() {
  return /** @type{?proto.codegrinder.Problem} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Problem, 3));
};


/**
 * @param {?proto.codegrinder.Problem|undefined} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
*/
proto.codegrinder.ProblemBundle.prototype.setProblem = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearProblem = function() {
  return this.setProblem(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ProblemBundle.prototype.hasProblem = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * repeated ProblemStep problem_steps = 4;
 * @return {!Array<!proto.codegrinder.ProblemStep>}
 */
proto.codegrinder.ProblemBundle.prototype.getProblemStepsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemStep>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemStep, 4));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemStep>} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
*/
proto.codegrinder.ProblemBundle.prototype.setProblemStepsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.codegrinder.ProblemStep=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemStep}
 */
proto.codegrinder.ProblemBundle.prototype.addProblemSteps = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.codegrinder.ProblemStep, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearProblemStepsList = function() {
  return this.setProblemStepsList([]);
};


/**
 * optional string problem_signature = 5;
 * @return {string}
 */
proto.codegrinder.ProblemBundle.prototype.getProblemSignature = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.setProblemSignature = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string hostname = 6;
 * @return {string}
 */
proto.codegrinder.ProblemBundle.prototype.getHostname = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.setHostname = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional int64 user_id = 7;
 * @return {number}
 */
proto.codegrinder.ProblemBundle.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 7, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 7, value);
};


/**
 * repeated Commit commits = 8;
 * @return {!Array<!proto.codegrinder.Commit>}
 */
proto.codegrinder.ProblemBundle.prototype.getCommitsList = function() {
  return /** @type{!Array<!proto.codegrinder.Commit>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Commit, 8));
};


/**
 * @param {!Array<!proto.codegrinder.Commit>} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
*/
proto.codegrinder.ProblemBundle.prototype.setCommitsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 8, value);
};


/**
 * @param {!proto.codegrinder.Commit=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Commit}
 */
proto.codegrinder.ProblemBundle.prototype.addCommits = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 8, opt_value, proto.codegrinder.Commit, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearCommitsList = function() {
  return this.setCommitsList([]);
};


/**
 * repeated string commit_signatures = 9;
 * @return {!Array<string>}
 */
proto.codegrinder.ProblemBundle.prototype.getCommitSignaturesList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 9));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.setCommitSignaturesList = function(value) {
  return jspb.Message.setField(this, 9, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.addCommitSignatures = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 9, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ProblemBundle} returns this
 */
proto.codegrinder.ProblemBundle.prototype.clearCommitSignaturesList = function() {
  return this.setCommitSignaturesList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ProblemSetBundle.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ProblemSetBundle.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ProblemSetBundle.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ProblemSetBundle} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSetBundle.toObject = function(includeInstance, msg) {
  var f, obj = {
problemSet: (f = msg.getProblemSet()) && proto.codegrinder.ProblemSet.toObject(includeInstance, f),
problemSetProblemsList: jspb.Message.toObjectList(msg.getProblemSetProblemsList(),
    proto.codegrinder.ProblemSetProblem.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.ProblemSetBundle.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ProblemSetBundle;
  return proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ProblemSetBundle} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSet;
      reader.readMessage(value,proto.codegrinder.ProblemSet.deserializeBinaryFromReader);
      msg.setProblemSet(value);
      break;
    case 2:
      var value = new proto.codegrinder.ProblemSetProblem;
      reader.readMessage(value,proto.codegrinder.ProblemSetProblem.deserializeBinaryFromReader);
      msg.addProblemSetProblems(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ProblemSetBundle.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ProblemSetBundle} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemSet();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemSet.serializeBinaryToWriter
    );
  }
  f = message.getProblemSetProblemsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.codegrinder.ProblemSetProblem.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemSet problem_set = 1;
 * @return {?proto.codegrinder.ProblemSet}
 */
proto.codegrinder.ProblemSetBundle.prototype.getProblemSet = function() {
  return /** @type{?proto.codegrinder.ProblemSet} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSet, 1));
};


/**
 * @param {?proto.codegrinder.ProblemSet|undefined} value
 * @return {!proto.codegrinder.ProblemSetBundle} returns this
*/
proto.codegrinder.ProblemSetBundle.prototype.setProblemSet = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ProblemSetBundle} returns this
 */
proto.codegrinder.ProblemSetBundle.prototype.clearProblemSet = function() {
  return this.setProblemSet(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ProblemSetBundle.prototype.hasProblemSet = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated ProblemSetProblem problem_set_problems = 2;
 * @return {!Array<!proto.codegrinder.ProblemSetProblem>}
 */
proto.codegrinder.ProblemSetBundle.prototype.getProblemSetProblemsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemSetProblem>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemSetProblem, 2));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemSetProblem>} value
 * @return {!proto.codegrinder.ProblemSetBundle} returns this
*/
proto.codegrinder.ProblemSetBundle.prototype.setProblemSetProblemsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.codegrinder.ProblemSetProblem=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemSetProblem}
 */
proto.codegrinder.ProblemSetBundle.prototype.addProblemSetProblems = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.codegrinder.ProblemSetProblem, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ProblemSetBundle} returns this
 */
proto.codegrinder.ProblemSetBundle.prototype.clearProblemSetProblemsList = function() {
  return this.setProblemSetProblemsList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.CommitBundle.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.CommitBundle.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.CommitBundle.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.CommitBundle} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.CommitBundle.toObject = function(includeInstance, msg) {
  var f, obj = {
problemType: (f = msg.getProblemType()) && proto.codegrinder.ProblemType.toObject(includeInstance, f),
problemTypeSignature: jspb.Message.getFieldWithDefault(msg, 2, ""),
problem: (f = msg.getProblem()) && proto.codegrinder.Problem.toObject(includeInstance, f),
problemStepsList: jspb.Message.toObjectList(msg.getProblemStepsList(),
    proto.codegrinder.ProblemStep.toObject, includeInstance),
problemSignature: jspb.Message.getFieldWithDefault(msg, 5, ""),
action: jspb.Message.getFieldWithDefault(msg, 6, ""),
hostname: jspb.Message.getFieldWithDefault(msg, 7, ""),
userId: jspb.Message.getFieldWithDefault(msg, 8, 0),
commit: (f = msg.getCommit()) && proto.codegrinder.Commit.toObject(includeInstance, f),
commitSignature: jspb.Message.getFieldWithDefault(msg, 10, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.CommitBundle}
 */
proto.codegrinder.CommitBundle.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.CommitBundle;
  return proto.codegrinder.CommitBundle.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.CommitBundle} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.CommitBundle}
 */
proto.codegrinder.CommitBundle.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemType;
      reader.readMessage(value,proto.codegrinder.ProblemType.deserializeBinaryFromReader);
      msg.setProblemType(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemTypeSignature(value);
      break;
    case 3:
      var value = new proto.codegrinder.Problem;
      reader.readMessage(value,proto.codegrinder.Problem.deserializeBinaryFromReader);
      msg.setProblem(value);
      break;
    case 4:
      var value = new proto.codegrinder.ProblemStep;
      reader.readMessage(value,proto.codegrinder.ProblemStep.deserializeBinaryFromReader);
      msg.addProblemSteps(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemSignature(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setAction(value);
      break;
    case 7:
      var value = /** @type {string} */ (reader.readString());
      msg.setHostname(value);
      break;
    case 8:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    case 9:
      var value = new proto.codegrinder.Commit;
      reader.readMessage(value,proto.codegrinder.Commit.deserializeBinaryFromReader);
      msg.setCommit(value);
      break;
    case 10:
      var value = /** @type {string} */ (reader.readString());
      msg.setCommitSignature(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.CommitBundle.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.CommitBundle.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.CommitBundle} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.CommitBundle.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemType();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemType.serializeBinaryToWriter
    );
  }
  f = message.getProblemTypeSignature();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getProblem();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.codegrinder.Problem.serializeBinaryToWriter
    );
  }
  f = message.getProblemStepsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.codegrinder.ProblemStep.serializeBinaryToWriter
    );
  }
  f = message.getProblemSignature();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getAction();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getHostname();
  if (f.length > 0) {
    writer.writeString(
      7,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      8,
      f
    );
  }
  f = message.getCommit();
  if (f != null) {
    writer.writeMessage(
      9,
      f,
      proto.codegrinder.Commit.serializeBinaryToWriter
    );
  }
  f = message.getCommitSignature();
  if (f.length > 0) {
    writer.writeString(
      10,
      f
    );
  }
};


/**
 * optional ProblemType problem_type = 1;
 * @return {?proto.codegrinder.ProblemType}
 */
proto.codegrinder.CommitBundle.prototype.getProblemType = function() {
  return /** @type{?proto.codegrinder.ProblemType} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemType, 1));
};


/**
 * @param {?proto.codegrinder.ProblemType|undefined} value
 * @return {!proto.codegrinder.CommitBundle} returns this
*/
proto.codegrinder.CommitBundle.prototype.setProblemType = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.clearProblemType = function() {
  return this.setProblemType(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.CommitBundle.prototype.hasProblemType = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string problem_type_signature = 2;
 * @return {string}
 */
proto.codegrinder.CommitBundle.prototype.getProblemTypeSignature = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setProblemTypeSignature = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional Problem problem = 3;
 * @return {?proto.codegrinder.Problem}
 */
proto.codegrinder.CommitBundle.prototype.getProblem = function() {
  return /** @type{?proto.codegrinder.Problem} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Problem, 3));
};


/**
 * @param {?proto.codegrinder.Problem|undefined} value
 * @return {!proto.codegrinder.CommitBundle} returns this
*/
proto.codegrinder.CommitBundle.prototype.setProblem = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.clearProblem = function() {
  return this.setProblem(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.CommitBundle.prototype.hasProblem = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * repeated ProblemStep problem_steps = 4;
 * @return {!Array<!proto.codegrinder.ProblemStep>}
 */
proto.codegrinder.CommitBundle.prototype.getProblemStepsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemStep>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemStep, 4));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemStep>} value
 * @return {!proto.codegrinder.CommitBundle} returns this
*/
proto.codegrinder.CommitBundle.prototype.setProblemStepsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.codegrinder.ProblemStep=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemStep}
 */
proto.codegrinder.CommitBundle.prototype.addProblemSteps = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.codegrinder.ProblemStep, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.clearProblemStepsList = function() {
  return this.setProblemStepsList([]);
};


/**
 * optional string problem_signature = 5;
 * @return {string}
 */
proto.codegrinder.CommitBundle.prototype.getProblemSignature = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setProblemSignature = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string action = 6;
 * @return {string}
 */
proto.codegrinder.CommitBundle.prototype.getAction = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setAction = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional string hostname = 7;
 * @return {string}
 */
proto.codegrinder.CommitBundle.prototype.getHostname = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 7, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setHostname = function(value) {
  return jspb.Message.setProto3StringField(this, 7, value);
};


/**
 * optional int64 user_id = 8;
 * @return {number}
 */
proto.codegrinder.CommitBundle.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 8, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 8, value);
};


/**
 * optional Commit commit = 9;
 * @return {?proto.codegrinder.Commit}
 */
proto.codegrinder.CommitBundle.prototype.getCommit = function() {
  return /** @type{?proto.codegrinder.Commit} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Commit, 9));
};


/**
 * @param {?proto.codegrinder.Commit|undefined} value
 * @return {!proto.codegrinder.CommitBundle} returns this
*/
proto.codegrinder.CommitBundle.prototype.setCommit = function(value) {
  return jspb.Message.setWrapperField(this, 9, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.clearCommit = function() {
  return this.setCommit(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.CommitBundle.prototype.hasCommit = function() {
  return jspb.Message.getField(this, 9) != null;
};


/**
 * optional string commit_signature = 10;
 * @return {string}
 */
proto.codegrinder.CommitBundle.prototype.getCommitSignature = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 10, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.CommitBundle} returns this
 */
proto.codegrinder.CommitBundle.prototype.setCommitSignature = function(value) {
  return jspb.Message.setProto3StringField(this, 10, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.DaycareRequest.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.DaycareRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.DaycareRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.DaycareRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.DaycareRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
commitBundle: (f = msg.getCommitBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f),
problemType: jspb.Message.getFieldWithDefault(msg, 2, ""),
action: jspb.Message.getFieldWithDefault(msg, 3, ""),
argsList: (f = jspb.Message.getRepeatedField(msg, 4)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.DaycareRequest}
 */
proto.codegrinder.DaycareRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.DaycareRequest;
  return proto.codegrinder.DaycareRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.DaycareRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.DaycareRequest}
 */
proto.codegrinder.DaycareRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setCommitBundle(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemType(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setAction(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.addArgs(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.DaycareRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.DaycareRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.DaycareRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.DaycareRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCommitBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
  f = message.getProblemType();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getAction();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getArgsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      4,
      f
    );
  }
};


/**
 * optional CommitBundle commit_bundle = 1;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.DaycareRequest.prototype.getCommitBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 1));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.DaycareRequest} returns this
*/
proto.codegrinder.DaycareRequest.prototype.setCommitBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.clearCommitBundle = function() {
  return this.setCommitBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.DaycareRequest.prototype.hasCommitBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string problem_type = 2;
 * @return {string}
 */
proto.codegrinder.DaycareRequest.prototype.getProblemType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.setProblemType = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string action = 3;
 * @return {string}
 */
proto.codegrinder.DaycareRequest.prototype.getAction = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.setAction = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * repeated string args = 4;
 * @return {!Array<string>}
 */
proto.codegrinder.DaycareRequest.prototype.getArgsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 4));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.setArgsList = function(value) {
  return jspb.Message.setField(this, 4, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.addArgs = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 4, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.DaycareRequest} returns this
 */
proto.codegrinder.DaycareRequest.prototype.clearArgsList = function() {
  return this.setArgsList([]);
};



/**
 * Oneof group definitions for this message. Each group defines the field
 * numbers belonging to that group. When of these fields' value is set, all
 * other fields in the group are cleared. During deserialization, if multiple
 * fields are encountered for a group, only the last value seen will be kept.
 * @private {!Array<!Array<number>>}
 * @const
 */
proto.codegrinder.DaycareResponse.oneofGroups_ = [[1,2,3]];

/**
 * @enum {number}
 */
proto.codegrinder.DaycareResponse.ResponseCase = {
  RESPONSE_NOT_SET: 0,
  EVENT: 1,
  ERROR: 2,
  COMMIT_BUNDLE: 3
};

/**
 * @return {proto.codegrinder.DaycareResponse.ResponseCase}
 */
proto.codegrinder.DaycareResponse.prototype.getResponseCase = function() {
  return /** @type {proto.codegrinder.DaycareResponse.ResponseCase} */(jspb.Message.computeOneofCase(this, proto.codegrinder.DaycareResponse.oneofGroups_[0]));
};



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.DaycareResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.DaycareResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.DaycareResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.DaycareResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
event: (f = msg.getEvent()) && proto.codegrinder.EventMessage.toObject(includeInstance, f),
error: (f = jspb.Message.getField(msg, 2)) == null ? undefined : f,
commitBundle: (f = msg.getCommitBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.DaycareResponse}
 */
proto.codegrinder.DaycareResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.DaycareResponse;
  return proto.codegrinder.DaycareResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.DaycareResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.DaycareResponse}
 */
proto.codegrinder.DaycareResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.EventMessage;
      reader.readMessage(value,proto.codegrinder.EventMessage.deserializeBinaryFromReader);
      msg.setEvent(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setError(value);
      break;
    case 3:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setCommitBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.DaycareResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.DaycareResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.DaycareResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.DaycareResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getEvent();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.EventMessage.serializeBinaryToWriter
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 2));
  if (f != null) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getCommitBundle();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional EventMessage event = 1;
 * @return {?proto.codegrinder.EventMessage}
 */
proto.codegrinder.DaycareResponse.prototype.getEvent = function() {
  return /** @type{?proto.codegrinder.EventMessage} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.EventMessage, 1));
};


/**
 * @param {?proto.codegrinder.EventMessage|undefined} value
 * @return {!proto.codegrinder.DaycareResponse} returns this
*/
proto.codegrinder.DaycareResponse.prototype.setEvent = function(value) {
  return jspb.Message.setOneofWrapperField(this, 1, proto.codegrinder.DaycareResponse.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.DaycareResponse} returns this
 */
proto.codegrinder.DaycareResponse.prototype.clearEvent = function() {
  return this.setEvent(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.DaycareResponse.prototype.hasEvent = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string error = 2;
 * @return {string}
 */
proto.codegrinder.DaycareResponse.prototype.getError = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.DaycareResponse} returns this
 */
proto.codegrinder.DaycareResponse.prototype.setError = function(value) {
  return jspb.Message.setOneofField(this, 2, proto.codegrinder.DaycareResponse.oneofGroups_[0], value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.codegrinder.DaycareResponse} returns this
 */
proto.codegrinder.DaycareResponse.prototype.clearError = function() {
  return jspb.Message.setOneofField(this, 2, proto.codegrinder.DaycareResponse.oneofGroups_[0], undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.DaycareResponse.prototype.hasError = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional CommitBundle commit_bundle = 3;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.DaycareResponse.prototype.getCommitBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 3));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.DaycareResponse} returns this
*/
proto.codegrinder.DaycareResponse.prototype.setCommitBundle = function(value) {
  return jspb.Message.setOneofWrapperField(this, 3, proto.codegrinder.DaycareResponse.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.DaycareResponse} returns this
 */
proto.codegrinder.DaycareResponse.prototype.clearCommitBundle = function() {
  return this.setCommitBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.DaycareResponse.prototype.hasCommitBundle = function() {
  return jspb.Message.getField(this, 3) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.Version.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.Version.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.Version} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Version.toObject = function(includeInstance, msg) {
  var f, obj = {
version: jspb.Message.getFieldWithDefault(msg, 1, ""),
grindVersionRequired: jspb.Message.getFieldWithDefault(msg, 2, ""),
grindVersionRecommended: jspb.Message.getFieldWithDefault(msg, 3, ""),
thonnyVersionRequired: jspb.Message.getFieldWithDefault(msg, 4, ""),
thonnyVersionRecommended: jspb.Message.getFieldWithDefault(msg, 5, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.Version}
 */
proto.codegrinder.Version.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.Version;
  return proto.codegrinder.Version.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.Version} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.Version}
 */
proto.codegrinder.Version.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setVersion(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setGrindVersionRequired(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setGrindVersionRecommended(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setThonnyVersionRequired(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setThonnyVersionRecommended(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.Version.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.Version.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.Version} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.Version.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getVersion();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getGrindVersionRequired();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getGrindVersionRecommended();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getThonnyVersionRequired();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getThonnyVersionRecommended();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
};


/**
 * optional string version = 1;
 * @return {string}
 */
proto.codegrinder.Version.prototype.getVersion = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Version} returns this
 */
proto.codegrinder.Version.prototype.setVersion = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string grind_version_required = 2;
 * @return {string}
 */
proto.codegrinder.Version.prototype.getGrindVersionRequired = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Version} returns this
 */
proto.codegrinder.Version.prototype.setGrindVersionRequired = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string grind_version_recommended = 3;
 * @return {string}
 */
proto.codegrinder.Version.prototype.getGrindVersionRecommended = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Version} returns this
 */
proto.codegrinder.Version.prototype.setGrindVersionRecommended = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string thonny_version_required = 4;
 * @return {string}
 */
proto.codegrinder.Version.prototype.getThonnyVersionRequired = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Version} returns this
 */
proto.codegrinder.Version.prototype.setThonnyVersionRequired = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string thonny_version_recommended = 5;
 * @return {string}
 */
proto.codegrinder.Version.prototype.getThonnyVersionRecommended = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.Version} returns this
 */
proto.codegrinder.Version.prototype.setThonnyVersionRecommended = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ListProblemsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ListProblemsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ListProblemsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ListProblemsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ListProblemsRequest}
 */
proto.codegrinder.ListProblemsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ListProblemsRequest;
  return proto.codegrinder.ListProblemsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ListProblemsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ListProblemsRequest}
 */
proto.codegrinder.ListProblemsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ListProblemsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ListProblemsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ListProblemsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ListProblemsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.ListProblemsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.ListProblemsRequest} returns this
 */
proto.codegrinder.ListProblemsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.ListProblemsResponse.repeatedFields_ = [2,3,4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.ListProblemsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.ListProblemsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.ListProblemsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ListProblemsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
user: (f = msg.getUser()) && proto.codegrinder.User.toObject(includeInstance, f),
assignmentsList: jspb.Message.toObjectList(msg.getAssignmentsList(),
    proto.codegrinder.Assignment.toObject, includeInstance),
coursesList: jspb.Message.toObjectList(msg.getCoursesList(),
    proto.codegrinder.Course.toObject, includeInstance),
problemSetsList: jspb.Message.toObjectList(msg.getProblemSetsList(),
    proto.codegrinder.ProblemSet.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.ListProblemsResponse}
 */
proto.codegrinder.ListProblemsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.ListProblemsResponse;
  return proto.codegrinder.ListProblemsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.ListProblemsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.ListProblemsResponse}
 */
proto.codegrinder.ListProblemsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.User;
      reader.readMessage(value,proto.codegrinder.User.deserializeBinaryFromReader);
      msg.setUser(value);
      break;
    case 2:
      var value = new proto.codegrinder.Assignment;
      reader.readMessage(value,proto.codegrinder.Assignment.deserializeBinaryFromReader);
      msg.addAssignments(value);
      break;
    case 3:
      var value = new proto.codegrinder.Course;
      reader.readMessage(value,proto.codegrinder.Course.deserializeBinaryFromReader);
      msg.addCourses(value);
      break;
    case 4:
      var value = new proto.codegrinder.ProblemSet;
      reader.readMessage(value,proto.codegrinder.ProblemSet.deserializeBinaryFromReader);
      msg.addProblemSets(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.ListProblemsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.ListProblemsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.ListProblemsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.ListProblemsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUser();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.User.serializeBinaryToWriter
    );
  }
  f = message.getAssignmentsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.codegrinder.Assignment.serializeBinaryToWriter
    );
  }
  f = message.getCoursesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.codegrinder.Course.serializeBinaryToWriter
    );
  }
  f = message.getProblemSetsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.codegrinder.ProblemSet.serializeBinaryToWriter
    );
  }
};


/**
 * optional User user = 1;
 * @return {?proto.codegrinder.User}
 */
proto.codegrinder.ListProblemsResponse.prototype.getUser = function() {
  return /** @type{?proto.codegrinder.User} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.User, 1));
};


/**
 * @param {?proto.codegrinder.User|undefined} value
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
*/
proto.codegrinder.ListProblemsResponse.prototype.setUser = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
 */
proto.codegrinder.ListProblemsResponse.prototype.clearUser = function() {
  return this.setUser(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.ListProblemsResponse.prototype.hasUser = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated Assignment assignments = 2;
 * @return {!Array<!proto.codegrinder.Assignment>}
 */
proto.codegrinder.ListProblemsResponse.prototype.getAssignmentsList = function() {
  return /** @type{!Array<!proto.codegrinder.Assignment>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Assignment, 2));
};


/**
 * @param {!Array<!proto.codegrinder.Assignment>} value
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
*/
proto.codegrinder.ListProblemsResponse.prototype.setAssignmentsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.codegrinder.Assignment=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.ListProblemsResponse.prototype.addAssignments = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.codegrinder.Assignment, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
 */
proto.codegrinder.ListProblemsResponse.prototype.clearAssignmentsList = function() {
  return this.setAssignmentsList([]);
};


/**
 * repeated Course courses = 3;
 * @return {!Array<!proto.codegrinder.Course>}
 */
proto.codegrinder.ListProblemsResponse.prototype.getCoursesList = function() {
  return /** @type{!Array<!proto.codegrinder.Course>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Course, 3));
};


/**
 * @param {!Array<!proto.codegrinder.Course>} value
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
*/
proto.codegrinder.ListProblemsResponse.prototype.setCoursesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.codegrinder.Course=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Course}
 */
proto.codegrinder.ListProblemsResponse.prototype.addCourses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.codegrinder.Course, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
 */
proto.codegrinder.ListProblemsResponse.prototype.clearCoursesList = function() {
  return this.setCoursesList([]);
};


/**
 * repeated ProblemSet problem_sets = 4;
 * @return {!Array<!proto.codegrinder.ProblemSet>}
 */
proto.codegrinder.ListProblemsResponse.prototype.getProblemSetsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemSet>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemSet, 4));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemSet>} value
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
*/
proto.codegrinder.ListProblemsResponse.prototype.setProblemSetsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.codegrinder.ProblemSet=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemSet}
 */
proto.codegrinder.ListProblemsResponse.prototype.addProblemSets = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.codegrinder.ProblemSet, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.ListProblemsResponse} returns this
 */
proto.codegrinder.ListProblemsResponse.prototype.clearProblemSetsList = function() {
  return this.setProblemSetsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetVersionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetVersionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetVersionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetVersionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {

  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetVersionRequest}
 */
proto.codegrinder.GetVersionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetVersionRequest;
  return proto.codegrinder.GetVersionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetVersionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetVersionRequest}
 */
proto.codegrinder.GetVersionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetVersionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetVersionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetVersionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetVersionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetVersionResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetVersionResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetVersionResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetVersionResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
version: (f = msg.getVersion()) && proto.codegrinder.Version.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetVersionResponse}
 */
proto.codegrinder.GetVersionResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetVersionResponse;
  return proto.codegrinder.GetVersionResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetVersionResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetVersionResponse}
 */
proto.codegrinder.GetVersionResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Version;
      reader.readMessage(value,proto.codegrinder.Version.deserializeBinaryFromReader);
      msg.setVersion(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetVersionResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetVersionResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetVersionResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetVersionResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getVersion();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Version.serializeBinaryToWriter
    );
  }
};


/**
 * optional Version version = 1;
 * @return {?proto.codegrinder.Version}
 */
proto.codegrinder.GetVersionResponse.prototype.getVersion = function() {
  return /** @type{?proto.codegrinder.Version} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Version, 1));
};


/**
 * @param {?proto.codegrinder.Version|undefined} value
 * @return {!proto.codegrinder.GetVersionResponse} returns this
*/
proto.codegrinder.GetVersionResponse.prototype.setVersion = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetVersionResponse} returns this
 */
proto.codegrinder.GetVersionResponse.prototype.clearVersion = function() {
  return this.setVersion(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetVersionResponse.prototype.hasVersion = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemTypesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemTypesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemTypesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemTypesRequest}
 */
proto.codegrinder.GetProblemTypesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemTypesRequest;
  return proto.codegrinder.GetProblemTypesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemTypesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemTypesRequest}
 */
proto.codegrinder.GetProblemTypesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemTypesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemTypesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemTypesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemTypesRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemTypesRequest} returns this
 */
proto.codegrinder.GetProblemTypesRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemTypesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemTypesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemTypesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemTypesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemTypesList: jspb.Message.toObjectList(msg.getProblemTypesList(),
    proto.codegrinder.ProblemType.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemTypesResponse}
 */
proto.codegrinder.GetProblemTypesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemTypesResponse;
  return proto.codegrinder.GetProblemTypesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemTypesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemTypesResponse}
 */
proto.codegrinder.GetProblemTypesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemType;
      reader.readMessage(value,proto.codegrinder.ProblemType.deserializeBinaryFromReader);
      msg.addProblemTypes(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemTypesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemTypesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemTypesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemTypesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.ProblemType.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ProblemType problem_types = 1;
 * @return {!Array<!proto.codegrinder.ProblemType>}
 */
proto.codegrinder.GetProblemTypesResponse.prototype.getProblemTypesList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemType>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemType, 1));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemType>} value
 * @return {!proto.codegrinder.GetProblemTypesResponse} returns this
*/
proto.codegrinder.GetProblemTypesResponse.prototype.setProblemTypesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.ProblemType=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemType}
 */
proto.codegrinder.GetProblemTypesResponse.prototype.addProblemTypes = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.ProblemType, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemTypesResponse} returns this
 */
proto.codegrinder.GetProblemTypesResponse.prototype.clearProblemTypesList = function() {
  return this.setProblemTypesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemTypeRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemTypeRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemTypeRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypeRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
name: jspb.Message.getFieldWithDefault(msg, 2, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemTypeRequest}
 */
proto.codegrinder.GetProblemTypeRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemTypeRequest;
  return proto.codegrinder.GetProblemTypeRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemTypeRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemTypeRequest}
 */
proto.codegrinder.GetProblemTypeRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemTypeRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemTypeRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemTypeRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypeRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemTypeRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemTypeRequest} returns this
 */
proto.codegrinder.GetProblemTypeRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string name = 2;
 * @return {string}
 */
proto.codegrinder.GetProblemTypeRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemTypeRequest} returns this
 */
proto.codegrinder.GetProblemTypeRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemTypeResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemTypeResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemTypeResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypeResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemType: (f = msg.getProblemType()) && proto.codegrinder.ProblemType.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemTypeResponse}
 */
proto.codegrinder.GetProblemTypeResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemTypeResponse;
  return proto.codegrinder.GetProblemTypeResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemTypeResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemTypeResponse}
 */
proto.codegrinder.GetProblemTypeResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemType;
      reader.readMessage(value,proto.codegrinder.ProblemType.deserializeBinaryFromReader);
      msg.setProblemType(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemTypeResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemTypeResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemTypeResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemTypeResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemType();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemType.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemType problem_type = 1;
 * @return {?proto.codegrinder.ProblemType}
 */
proto.codegrinder.GetProblemTypeResponse.prototype.getProblemType = function() {
  return /** @type{?proto.codegrinder.ProblemType} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemType, 1));
};


/**
 * @param {?proto.codegrinder.ProblemType|undefined} value
 * @return {!proto.codegrinder.GetProblemTypeResponse} returns this
*/
proto.codegrinder.GetProblemTypeResponse.prototype.setProblemType = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetProblemTypeResponse} returns this
 */
proto.codegrinder.GetProblemTypeResponse.prototype.clearProblemType = function() {
  return this.setProblemType(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetProblemTypeResponse.prototype.hasProblemType = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
unique: jspb.Message.getFieldWithDefault(msg, 2, ""),
problemType: jspb.Message.getFieldWithDefault(msg, 3, ""),
note: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemsRequest}
 */
proto.codegrinder.GetProblemsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemsRequest;
  return proto.codegrinder.GetProblemsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemsRequest}
 */
proto.codegrinder.GetProblemsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setUnique(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setProblemType(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getUnique();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getProblemType();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string unique = 2;
 * @return {string}
 */
proto.codegrinder.GetProblemsRequest.prototype.getUnique = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemsRequest.prototype.setUnique = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string problem_type = 3;
 * @return {string}
 */
proto.codegrinder.GetProblemsRequest.prototype.getProblemType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemsRequest.prototype.setProblemType = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string note = 4;
 * @return {string}
 */
proto.codegrinder.GetProblemsRequest.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemsRequest.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemsList: jspb.Message.toObjectList(msg.getProblemsList(),
    proto.codegrinder.Problem.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemsResponse}
 */
proto.codegrinder.GetProblemsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemsResponse;
  return proto.codegrinder.GetProblemsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemsResponse}
 */
proto.codegrinder.GetProblemsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Problem;
      reader.readMessage(value,proto.codegrinder.Problem.deserializeBinaryFromReader);
      msg.addProblems(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.Problem.serializeBinaryToWriter
    );
  }
};


/**
 * repeated Problem problems = 1;
 * @return {!Array<!proto.codegrinder.Problem>}
 */
proto.codegrinder.GetProblemsResponse.prototype.getProblemsList = function() {
  return /** @type{!Array<!proto.codegrinder.Problem>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Problem, 1));
};


/**
 * @param {!Array<!proto.codegrinder.Problem>} value
 * @return {!proto.codegrinder.GetProblemsResponse} returns this
*/
proto.codegrinder.GetProblemsResponse.prototype.setProblemsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.Problem=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Problem}
 */
proto.codegrinder.GetProblemsResponse.prototype.addProblems = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.Problem, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemsResponse} returns this
 */
proto.codegrinder.GetProblemsResponse.prototype.clearProblemsList = function() {
  return this.setProblemsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemRequest}
 */
proto.codegrinder.GetProblemRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemRequest;
  return proto.codegrinder.GetProblemRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemRequest}
 */
proto.codegrinder.GetProblemRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemRequest} returns this
 */
proto.codegrinder.GetProblemRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_id = 2;
 * @return {number}
 */
proto.codegrinder.GetProblemRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemRequest} returns this
 */
proto.codegrinder.GetProblemRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problem: (f = msg.getProblem()) && proto.codegrinder.Problem.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemResponse}
 */
proto.codegrinder.GetProblemResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemResponse;
  return proto.codegrinder.GetProblemResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemResponse}
 */
proto.codegrinder.GetProblemResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Problem;
      reader.readMessage(value,proto.codegrinder.Problem.deserializeBinaryFromReader);
      msg.setProblem(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblem();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Problem.serializeBinaryToWriter
    );
  }
};


/**
 * optional Problem problem = 1;
 * @return {?proto.codegrinder.Problem}
 */
proto.codegrinder.GetProblemResponse.prototype.getProblem = function() {
  return /** @type{?proto.codegrinder.Problem} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Problem, 1));
};


/**
 * @param {?proto.codegrinder.Problem|undefined} value
 * @return {!proto.codegrinder.GetProblemResponse} returns this
*/
proto.codegrinder.GetProblemResponse.prototype.setProblem = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetProblemResponse} returns this
 */
proto.codegrinder.GetProblemResponse.prototype.clearProblem = function() {
  return this.setProblem(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetProblemResponse.prototype.hasProblem = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemStepsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemStepsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemStepsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemStepsRequest}
 */
proto.codegrinder.GetProblemStepsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemStepsRequest;
  return proto.codegrinder.GetProblemStepsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemStepsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemStepsRequest}
 */
proto.codegrinder.GetProblemStepsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemStepsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemStepsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemStepsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemStepsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemStepsRequest} returns this
 */
proto.codegrinder.GetProblemStepsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_id = 2;
 * @return {number}
 */
proto.codegrinder.GetProblemStepsRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemStepsRequest} returns this
 */
proto.codegrinder.GetProblemStepsRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemStepsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemStepsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemStepsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemStepsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemStepsList: jspb.Message.toObjectList(msg.getProblemStepsList(),
    proto.codegrinder.ProblemStep.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemStepsResponse}
 */
proto.codegrinder.GetProblemStepsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemStepsResponse;
  return proto.codegrinder.GetProblemStepsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemStepsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemStepsResponse}
 */
proto.codegrinder.GetProblemStepsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemStep;
      reader.readMessage(value,proto.codegrinder.ProblemStep.deserializeBinaryFromReader);
      msg.addProblemSteps(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemStepsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemStepsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemStepsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemStepsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.ProblemStep.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ProblemStep problem_steps = 1;
 * @return {!Array<!proto.codegrinder.ProblemStep>}
 */
proto.codegrinder.GetProblemStepsResponse.prototype.getProblemStepsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemStep>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemStep, 1));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemStep>} value
 * @return {!proto.codegrinder.GetProblemStepsResponse} returns this
*/
proto.codegrinder.GetProblemStepsResponse.prototype.setProblemStepsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.ProblemStep=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemStep}
 */
proto.codegrinder.GetProblemStepsResponse.prototype.addProblemSteps = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.ProblemStep, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemStepsResponse} returns this
 */
proto.codegrinder.GetProblemStepsResponse.prototype.clearProblemStepsList = function() {
  return this.setProblemStepsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemStepRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemStepRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemStepRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemId: jspb.Message.getFieldWithDefault(msg, 2, 0),
step: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemStepRequest}
 */
proto.codegrinder.GetProblemStepRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemStepRequest;
  return proto.codegrinder.GetProblemStepRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemStepRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemStepRequest}
 */
proto.codegrinder.GetProblemStepRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setStep(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemStepRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemStepRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemStepRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getStep();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemStepRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemStepRequest} returns this
 */
proto.codegrinder.GetProblemStepRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_id = 2;
 * @return {number}
 */
proto.codegrinder.GetProblemStepRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemStepRequest} returns this
 */
proto.codegrinder.GetProblemStepRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 step = 3;
 * @return {number}
 */
proto.codegrinder.GetProblemStepRequest.prototype.getStep = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemStepRequest} returns this
 */
proto.codegrinder.GetProblemStepRequest.prototype.setStep = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemStepResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemStepResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemStepResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemStep: (f = msg.getProblemStep()) && proto.codegrinder.ProblemStep.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemStepResponse}
 */
proto.codegrinder.GetProblemStepResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemStepResponse;
  return proto.codegrinder.GetProblemStepResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemStepResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemStepResponse}
 */
proto.codegrinder.GetProblemStepResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemStep;
      reader.readMessage(value,proto.codegrinder.ProblemStep.deserializeBinaryFromReader);
      msg.setProblemStep(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemStepResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemStepResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemStepResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemStepResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemStep();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemStep.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemStep problem_step = 1;
 * @return {?proto.codegrinder.ProblemStep}
 */
proto.codegrinder.GetProblemStepResponse.prototype.getProblemStep = function() {
  return /** @type{?proto.codegrinder.ProblemStep} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemStep, 1));
};


/**
 * @param {?proto.codegrinder.ProblemStep|undefined} value
 * @return {!proto.codegrinder.GetProblemStepResponse} returns this
*/
proto.codegrinder.GetProblemStepResponse.prototype.setProblemStep = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetProblemStepResponse} returns this
 */
proto.codegrinder.GetProblemStepResponse.prototype.clearProblemStep = function() {
  return this.setProblemStep(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetProblemStepResponse.prototype.hasProblemStep = function() {
  return jspb.Message.getField(this, 1) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemSetsRequest.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
unique: jspb.Message.getFieldWithDefault(msg, 2, ""),
note: jspb.Message.getFieldWithDefault(msg, 3, ""),
searchList: (f = jspb.Message.getRepeatedField(msg, 4)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetsRequest}
 */
proto.codegrinder.GetProblemSetsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetsRequest;
  return proto.codegrinder.GetProblemSetsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetsRequest}
 */
proto.codegrinder.GetProblemSetsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setUnique(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setNote(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.addSearch(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getUnique();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getNote();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getSearchList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      4,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string unique = 2;
 * @return {string}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.getUnique = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.setUnique = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string note = 3;
 * @return {string}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.getNote = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.setNote = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * repeated string search = 4;
 * @return {!Array<string>}
 */
proto.codegrinder.GetProblemSetsRequest.prototype.getSearchList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 4));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.setSearchList = function(value) {
  return jspb.Message.setField(this, 4, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.addSearch = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 4, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemSetsRequest} returns this
 */
proto.codegrinder.GetProblemSetsRequest.prototype.clearSearchList = function() {
  return this.setSearchList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemSetsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemSetsList: jspb.Message.toObjectList(msg.getProblemSetsList(),
    proto.codegrinder.ProblemSet.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetsResponse}
 */
proto.codegrinder.GetProblemSetsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetsResponse;
  return proto.codegrinder.GetProblemSetsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetsResponse}
 */
proto.codegrinder.GetProblemSetsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSet;
      reader.readMessage(value,proto.codegrinder.ProblemSet.deserializeBinaryFromReader);
      msg.addProblemSets(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemSetsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.ProblemSet.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ProblemSet problem_sets = 1;
 * @return {!Array<!proto.codegrinder.ProblemSet>}
 */
proto.codegrinder.GetProblemSetsResponse.prototype.getProblemSetsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemSet>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemSet, 1));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemSet>} value
 * @return {!proto.codegrinder.GetProblemSetsResponse} returns this
*/
proto.codegrinder.GetProblemSetsResponse.prototype.setProblemSetsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.ProblemSet=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemSet}
 */
proto.codegrinder.GetProblemSetsResponse.prototype.addProblemSets = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.ProblemSet, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemSetsResponse} returns this
 */
proto.codegrinder.GetProblemSetsResponse.prototype.clearProblemSetsList = function() {
  return this.setProblemSetsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemSetId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetRequest}
 */
proto.codegrinder.GetProblemSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetRequest;
  return proto.codegrinder.GetProblemSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetRequest}
 */
proto.codegrinder.GetProblemSetRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemSetId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemSetId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemSetRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemSetRequest} returns this
 */
proto.codegrinder.GetProblemSetRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_set_id = 2;
 * @return {number}
 */
proto.codegrinder.GetProblemSetRequest.prototype.getProblemSetId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemSetRequest} returns this
 */
proto.codegrinder.GetProblemSetRequest.prototype.setProblemSetId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemSet: (f = msg.getProblemSet()) && proto.codegrinder.ProblemSet.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetResponse}
 */
proto.codegrinder.GetProblemSetResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetResponse;
  return proto.codegrinder.GetProblemSetResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetResponse}
 */
proto.codegrinder.GetProblemSetResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSet;
      reader.readMessage(value,proto.codegrinder.ProblemSet.deserializeBinaryFromReader);
      msg.setProblemSet(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemSet();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemSet.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemSet problem_set = 1;
 * @return {?proto.codegrinder.ProblemSet}
 */
proto.codegrinder.GetProblemSetResponse.prototype.getProblemSet = function() {
  return /** @type{?proto.codegrinder.ProblemSet} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSet, 1));
};


/**
 * @param {?proto.codegrinder.ProblemSet|undefined} value
 * @return {!proto.codegrinder.GetProblemSetResponse} returns this
*/
proto.codegrinder.GetProblemSetResponse.prototype.setProblemSet = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetProblemSetResponse} returns this
 */
proto.codegrinder.GetProblemSetResponse.prototype.clearProblemSet = function() {
  return this.setProblemSet(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetProblemSetResponse.prototype.hasProblemSet = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetProblemsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetProblemsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetProblemsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemSetId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetProblemsRequest}
 */
proto.codegrinder.GetProblemSetProblemsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetProblemsRequest;
  return proto.codegrinder.GetProblemSetProblemsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetProblemsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetProblemsRequest}
 */
proto.codegrinder.GetProblemSetProblemsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemSetId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetProblemsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetProblemsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetProblemsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemSetId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetProblemSetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_set_id = 2;
 * @return {number}
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.getProblemSetId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetProblemSetProblemsRequest} returns this
 */
proto.codegrinder.GetProblemSetProblemsRequest.prototype.setProblemSetId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetProblemSetProblemsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetProblemSetProblemsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetProblemSetProblemsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetProblemSetProblemsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetProblemsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
problemSetProblemsList: jspb.Message.toObjectList(msg.getProblemSetProblemsList(),
    proto.codegrinder.ProblemSetProblem.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetProblemSetProblemsResponse}
 */
proto.codegrinder.GetProblemSetProblemsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetProblemSetProblemsResponse;
  return proto.codegrinder.GetProblemSetProblemsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetProblemSetProblemsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetProblemSetProblemsResponse}
 */
proto.codegrinder.GetProblemSetProblemsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSetProblem;
      reader.readMessage(value,proto.codegrinder.ProblemSetProblem.deserializeBinaryFromReader);
      msg.addProblemSetProblems(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetProblemSetProblemsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetProblemSetProblemsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetProblemSetProblemsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetProblemSetProblemsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProblemSetProblemsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.ProblemSetProblem.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ProblemSetProblem problem_set_problems = 1;
 * @return {!Array<!proto.codegrinder.ProblemSetProblem>}
 */
proto.codegrinder.GetProblemSetProblemsResponse.prototype.getProblemSetProblemsList = function() {
  return /** @type{!Array<!proto.codegrinder.ProblemSetProblem>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.ProblemSetProblem, 1));
};


/**
 * @param {!Array<!proto.codegrinder.ProblemSetProblem>} value
 * @return {!proto.codegrinder.GetProblemSetProblemsResponse} returns this
*/
proto.codegrinder.GetProblemSetProblemsResponse.prototype.setProblemSetProblemsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.ProblemSetProblem=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.ProblemSetProblem}
 */
proto.codegrinder.GetProblemSetProblemsResponse.prototype.addProblemSetProblems = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.ProblemSetProblem, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetProblemSetProblemsResponse} returns this
 */
proto.codegrinder.GetProblemSetProblemsResponse.prototype.clearProblemSetProblemsList = function() {
  return this.setProblemSetProblemsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCoursesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCoursesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCoursesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCoursesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
ltiLabel: jspb.Message.getFieldWithDefault(msg, 2, ""),
name: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCoursesRequest}
 */
proto.codegrinder.GetCoursesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCoursesRequest;
  return proto.codegrinder.GetCoursesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCoursesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCoursesRequest}
 */
proto.codegrinder.GetCoursesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setLtiLabel(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCoursesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCoursesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCoursesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCoursesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getLtiLabel();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetCoursesRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCoursesRequest} returns this
 */
proto.codegrinder.GetCoursesRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string lti_label = 2;
 * @return {string}
 */
proto.codegrinder.GetCoursesRequest.prototype.getLtiLabel = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCoursesRequest} returns this
 */
proto.codegrinder.GetCoursesRequest.prototype.setLtiLabel = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string name = 3;
 * @return {string}
 */
proto.codegrinder.GetCoursesRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCoursesRequest} returns this
 */
proto.codegrinder.GetCoursesRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetCoursesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCoursesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCoursesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCoursesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCoursesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
coursesList: jspb.Message.toObjectList(msg.getCoursesList(),
    proto.codegrinder.Course.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCoursesResponse}
 */
proto.codegrinder.GetCoursesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCoursesResponse;
  return proto.codegrinder.GetCoursesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCoursesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCoursesResponse}
 */
proto.codegrinder.GetCoursesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Course;
      reader.readMessage(value,proto.codegrinder.Course.deserializeBinaryFromReader);
      msg.addCourses(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCoursesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCoursesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCoursesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCoursesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCoursesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.Course.serializeBinaryToWriter
    );
  }
};


/**
 * repeated Course courses = 1;
 * @return {!Array<!proto.codegrinder.Course>}
 */
proto.codegrinder.GetCoursesResponse.prototype.getCoursesList = function() {
  return /** @type{!Array<!proto.codegrinder.Course>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Course, 1));
};


/**
 * @param {!Array<!proto.codegrinder.Course>} value
 * @return {!proto.codegrinder.GetCoursesResponse} returns this
*/
proto.codegrinder.GetCoursesResponse.prototype.setCoursesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.Course=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Course}
 */
proto.codegrinder.GetCoursesResponse.prototype.addCourses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.Course, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetCoursesResponse} returns this
 */
proto.codegrinder.GetCoursesResponse.prototype.clearCoursesList = function() {
  return this.setCoursesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
courseId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseRequest}
 */
proto.codegrinder.GetCourseRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseRequest;
  return proto.codegrinder.GetCourseRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseRequest}
 */
proto.codegrinder.GetCourseRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCourseId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getCourseId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetCourseRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCourseRequest} returns this
 */
proto.codegrinder.GetCourseRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 course_id = 2;
 * @return {number}
 */
proto.codegrinder.GetCourseRequest.prototype.getCourseId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetCourseRequest} returns this
 */
proto.codegrinder.GetCourseRequest.prototype.setCourseId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
course: (f = msg.getCourse()) && proto.codegrinder.Course.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseResponse}
 */
proto.codegrinder.GetCourseResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseResponse;
  return proto.codegrinder.GetCourseResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseResponse}
 */
proto.codegrinder.GetCourseResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Course;
      reader.readMessage(value,proto.codegrinder.Course.deserializeBinaryFromReader);
      msg.setCourse(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCourse();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Course.serializeBinaryToWriter
    );
  }
};


/**
 * optional Course course = 1;
 * @return {?proto.codegrinder.Course}
 */
proto.codegrinder.GetCourseResponse.prototype.getCourse = function() {
  return /** @type{?proto.codegrinder.Course} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Course, 1));
};


/**
 * @param {?proto.codegrinder.Course|undefined} value
 * @return {!proto.codegrinder.GetCourseResponse} returns this
*/
proto.codegrinder.GetCourseResponse.prototype.setCourse = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetCourseResponse} returns this
 */
proto.codegrinder.GetCourseResponse.prototype.clearCourse = function() {
  return this.setCourse(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetCourseResponse.prototype.hasCourse = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUsersRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUsersRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUsersRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUsersRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
name: jspb.Message.getFieldWithDefault(msg, 2, ""),
email: jspb.Message.getFieldWithDefault(msg, 3, ""),
instructor: jspb.Message.getFieldWithDefault(msg, 4, ""),
admin: jspb.Message.getFieldWithDefault(msg, 5, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUsersRequest}
 */
proto.codegrinder.GetUsersRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUsersRequest;
  return proto.codegrinder.GetUsersRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUsersRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUsersRequest}
 */
proto.codegrinder.GetUsersRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setEmail(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setInstructor(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setAdmin(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUsersRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUsersRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUsersRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUsersRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getEmail();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getInstructor();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getAdmin();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetUsersRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUsersRequest} returns this
 */
proto.codegrinder.GetUsersRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string name = 2;
 * @return {string}
 */
proto.codegrinder.GetUsersRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUsersRequest} returns this
 */
proto.codegrinder.GetUsersRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string email = 3;
 * @return {string}
 */
proto.codegrinder.GetUsersRequest.prototype.getEmail = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUsersRequest} returns this
 */
proto.codegrinder.GetUsersRequest.prototype.setEmail = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string instructor = 4;
 * @return {string}
 */
proto.codegrinder.GetUsersRequest.prototype.getInstructor = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUsersRequest} returns this
 */
proto.codegrinder.GetUsersRequest.prototype.setInstructor = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string admin = 5;
 * @return {string}
 */
proto.codegrinder.GetUsersRequest.prototype.getAdmin = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUsersRequest} returns this
 */
proto.codegrinder.GetUsersRequest.prototype.setAdmin = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetUsersResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUsersResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUsersResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUsersResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUsersResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
usersList: jspb.Message.toObjectList(msg.getUsersList(),
    proto.codegrinder.User.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUsersResponse}
 */
proto.codegrinder.GetUsersResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUsersResponse;
  return proto.codegrinder.GetUsersResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUsersResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUsersResponse}
 */
proto.codegrinder.GetUsersResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.User;
      reader.readMessage(value,proto.codegrinder.User.deserializeBinaryFromReader);
      msg.addUsers(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUsersResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUsersResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUsersResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUsersResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUsersList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.User.serializeBinaryToWriter
    );
  }
};


/**
 * repeated User users = 1;
 * @return {!Array<!proto.codegrinder.User>}
 */
proto.codegrinder.GetUsersResponse.prototype.getUsersList = function() {
  return /** @type{!Array<!proto.codegrinder.User>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.User, 1));
};


/**
 * @param {!Array<!proto.codegrinder.User>} value
 * @return {!proto.codegrinder.GetUsersResponse} returns this
*/
proto.codegrinder.GetUsersResponse.prototype.setUsersList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.User=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.User}
 */
proto.codegrinder.GetUsersResponse.prototype.addUsers = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.User, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetUsersResponse} returns this
 */
proto.codegrinder.GetUsersResponse.prototype.clearUsersList = function() {
  return this.setUsersList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserMeRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserMeRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserMeRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserMeRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserMeRequest}
 */
proto.codegrinder.GetUserMeRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserMeRequest;
  return proto.codegrinder.GetUserMeRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserMeRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserMeRequest}
 */
proto.codegrinder.GetUserMeRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserMeRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserMeRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserMeRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserMeRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetUserMeRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUserMeRequest} returns this
 */
proto.codegrinder.GetUserMeRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserMeResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserMeResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserMeResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserMeResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
user: (f = msg.getUser()) && proto.codegrinder.User.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserMeResponse}
 */
proto.codegrinder.GetUserMeResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserMeResponse;
  return proto.codegrinder.GetUserMeResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserMeResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserMeResponse}
 */
proto.codegrinder.GetUserMeResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.User;
      reader.readMessage(value,proto.codegrinder.User.deserializeBinaryFromReader);
      msg.setUser(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserMeResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserMeResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserMeResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserMeResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUser();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.User.serializeBinaryToWriter
    );
  }
};


/**
 * optional User user = 1;
 * @return {?proto.codegrinder.User}
 */
proto.codegrinder.GetUserMeResponse.prototype.getUser = function() {
  return /** @type{?proto.codegrinder.User} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.User, 1));
};


/**
 * @param {?proto.codegrinder.User|undefined} value
 * @return {!proto.codegrinder.GetUserMeResponse} returns this
*/
proto.codegrinder.GetUserMeResponse.prototype.setUser = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetUserMeResponse} returns this
 */
proto.codegrinder.GetUserMeResponse.prototype.clearUser = function() {
  return this.setUser(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetUserMeResponse.prototype.hasUser = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
userId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserRequest}
 */
proto.codegrinder.GetUserRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserRequest;
  return proto.codegrinder.GetUserRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserRequest}
 */
proto.codegrinder.GetUserRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetUserRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUserRequest} returns this
 */
proto.codegrinder.GetUserRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 user_id = 2;
 * @return {number}
 */
proto.codegrinder.GetUserRequest.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetUserRequest} returns this
 */
proto.codegrinder.GetUserRequest.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
user: (f = msg.getUser()) && proto.codegrinder.User.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserResponse}
 */
proto.codegrinder.GetUserResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserResponse;
  return proto.codegrinder.GetUserResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserResponse}
 */
proto.codegrinder.GetUserResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.User;
      reader.readMessage(value,proto.codegrinder.User.deserializeBinaryFromReader);
      msg.setUser(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUser();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.User.serializeBinaryToWriter
    );
  }
};


/**
 * optional User user = 1;
 * @return {?proto.codegrinder.User}
 */
proto.codegrinder.GetUserResponse.prototype.getUser = function() {
  return /** @type{?proto.codegrinder.User} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.User, 1));
};


/**
 * @param {?proto.codegrinder.User|undefined} value
 * @return {!proto.codegrinder.GetUserResponse} returns this
*/
proto.codegrinder.GetUserResponse.prototype.setUser = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetUserResponse} returns this
 */
proto.codegrinder.GetUserResponse.prototype.clearUser = function() {
  return this.setUser(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetUserResponse.prototype.hasUser = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseUsersRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseUsersRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseUsersRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUsersRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
courseId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseUsersRequest}
 */
proto.codegrinder.GetCourseUsersRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseUsersRequest;
  return proto.codegrinder.GetCourseUsersRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseUsersRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseUsersRequest}
 */
proto.codegrinder.GetCourseUsersRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCourseId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseUsersRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseUsersRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseUsersRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUsersRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getCourseId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetCourseUsersRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCourseUsersRequest} returns this
 */
proto.codegrinder.GetCourseUsersRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 course_id = 2;
 * @return {number}
 */
proto.codegrinder.GetCourseUsersRequest.prototype.getCourseId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetCourseUsersRequest} returns this
 */
proto.codegrinder.GetCourseUsersRequest.prototype.setCourseId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetCourseUsersResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseUsersResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseUsersResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseUsersResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUsersResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
usersList: jspb.Message.toObjectList(msg.getUsersList(),
    proto.codegrinder.User.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseUsersResponse}
 */
proto.codegrinder.GetCourseUsersResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseUsersResponse;
  return proto.codegrinder.GetCourseUsersResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseUsersResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseUsersResponse}
 */
proto.codegrinder.GetCourseUsersResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.User;
      reader.readMessage(value,proto.codegrinder.User.deserializeBinaryFromReader);
      msg.addUsers(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseUsersResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseUsersResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseUsersResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUsersResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUsersList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.User.serializeBinaryToWriter
    );
  }
};


/**
 * repeated User users = 1;
 * @return {!Array<!proto.codegrinder.User>}
 */
proto.codegrinder.GetCourseUsersResponse.prototype.getUsersList = function() {
  return /** @type{!Array<!proto.codegrinder.User>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.User, 1));
};


/**
 * @param {!Array<!proto.codegrinder.User>} value
 * @return {!proto.codegrinder.GetCourseUsersResponse} returns this
*/
proto.codegrinder.GetCourseUsersResponse.prototype.setUsersList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.User=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.User}
 */
proto.codegrinder.GetCourseUsersResponse.prototype.addUsers = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.User, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetCourseUsersResponse} returns this
 */
proto.codegrinder.GetCourseUsersResponse.prototype.clearUsersList = function() {
  return this.setUsersList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserAssignmentsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserAssignmentsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserAssignmentsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
userId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserAssignmentsRequest}
 */
proto.codegrinder.GetUserAssignmentsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserAssignmentsRequest;
  return proto.codegrinder.GetUserAssignmentsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserAssignmentsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserAssignmentsRequest}
 */
proto.codegrinder.GetUserAssignmentsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserAssignmentsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserAssignmentsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserAssignmentsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetUserAssignmentsRequest} returns this
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 user_id = 2;
 * @return {number}
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetUserAssignmentsRequest} returns this
 */
proto.codegrinder.GetUserAssignmentsRequest.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetUserAssignmentsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetUserAssignmentsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetUserAssignmentsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetUserAssignmentsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserAssignmentsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
assignmentsList: jspb.Message.toObjectList(msg.getAssignmentsList(),
    proto.codegrinder.Assignment.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetUserAssignmentsResponse}
 */
proto.codegrinder.GetUserAssignmentsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetUserAssignmentsResponse;
  return proto.codegrinder.GetUserAssignmentsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetUserAssignmentsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetUserAssignmentsResponse}
 */
proto.codegrinder.GetUserAssignmentsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Assignment;
      reader.readMessage(value,proto.codegrinder.Assignment.deserializeBinaryFromReader);
      msg.addAssignments(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetUserAssignmentsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetUserAssignmentsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetUserAssignmentsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetUserAssignmentsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAssignmentsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.Assignment.serializeBinaryToWriter
    );
  }
};


/**
 * repeated Assignment assignments = 1;
 * @return {!Array<!proto.codegrinder.Assignment>}
 */
proto.codegrinder.GetUserAssignmentsResponse.prototype.getAssignmentsList = function() {
  return /** @type{!Array<!proto.codegrinder.Assignment>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Assignment, 1));
};


/**
 * @param {!Array<!proto.codegrinder.Assignment>} value
 * @return {!proto.codegrinder.GetUserAssignmentsResponse} returns this
*/
proto.codegrinder.GetUserAssignmentsResponse.prototype.setAssignmentsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.Assignment=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.GetUserAssignmentsResponse.prototype.addAssignments = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.Assignment, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetUserAssignmentsResponse} returns this
 */
proto.codegrinder.GetUserAssignmentsResponse.prototype.clearAssignmentsList = function() {
  return this.setAssignmentsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseUserAssignmentsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseUserAssignmentsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
courseId: jspb.Message.getFieldWithDefault(msg, 2, 0),
userId: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseUserAssignmentsRequest}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseUserAssignmentsRequest;
  return proto.codegrinder.GetCourseUserAssignmentsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseUserAssignmentsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseUserAssignmentsRequest}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setCourseId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setUserId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseUserAssignmentsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseUserAssignmentsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getCourseId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getUserId();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetCourseUserAssignmentsRequest} returns this
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 course_id = 2;
 * @return {number}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.getCourseId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetCourseUserAssignmentsRequest} returns this
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.setCourseId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 user_id = 3;
 * @return {number}
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.getUserId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetCourseUserAssignmentsRequest} returns this
 */
proto.codegrinder.GetCourseUserAssignmentsRequest.prototype.setUserId = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetCourseUserAssignmentsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetCourseUserAssignmentsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
assignmentsList: jspb.Message.toObjectList(msg.getAssignmentsList(),
    proto.codegrinder.Assignment.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetCourseUserAssignmentsResponse}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetCourseUserAssignmentsResponse;
  return proto.codegrinder.GetCourseUserAssignmentsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetCourseUserAssignmentsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetCourseUserAssignmentsResponse}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Assignment;
      reader.readMessage(value,proto.codegrinder.Assignment.deserializeBinaryFromReader);
      msg.addAssignments(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetCourseUserAssignmentsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetCourseUserAssignmentsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAssignmentsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.Assignment.serializeBinaryToWriter
    );
  }
};


/**
 * repeated Assignment assignments = 1;
 * @return {!Array<!proto.codegrinder.Assignment>}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.getAssignmentsList = function() {
  return /** @type{!Array<!proto.codegrinder.Assignment>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Assignment, 1));
};


/**
 * @param {!Array<!proto.codegrinder.Assignment>} value
 * @return {!proto.codegrinder.GetCourseUserAssignmentsResponse} returns this
*/
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.setAssignmentsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.Assignment=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.addAssignments = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.Assignment, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetCourseUserAssignmentsResponse} returns this
 */
proto.codegrinder.GetCourseUserAssignmentsResponse.prototype.clearAssignmentsList = function() {
  return this.setAssignmentsList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetAssignmentsRequest.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
searchList: (f = jspb.Message.getRepeatedField(msg, 2)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentsRequest}
 */
proto.codegrinder.GetAssignmentsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentsRequest;
  return proto.codegrinder.GetAssignmentsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentsRequest}
 */
proto.codegrinder.GetAssignmentsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.addSearch(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getSearchList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetAssignmentsRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetAssignmentsRequest} returns this
 */
proto.codegrinder.GetAssignmentsRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * repeated string search = 2;
 * @return {!Array<string>}
 */
proto.codegrinder.GetAssignmentsRequest.prototype.getSearchList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 2));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.codegrinder.GetAssignmentsRequest} returns this
 */
proto.codegrinder.GetAssignmentsRequest.prototype.setSearchList = function(value) {
  return jspb.Message.setField(this, 2, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.GetAssignmentsRequest} returns this
 */
proto.codegrinder.GetAssignmentsRequest.prototype.addSearch = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 2, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetAssignmentsRequest} returns this
 */
proto.codegrinder.GetAssignmentsRequest.prototype.clearSearchList = function() {
  return this.setSearchList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.codegrinder.GetAssignmentsResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
assignmentsList: jspb.Message.toObjectList(msg.getAssignmentsList(),
    proto.codegrinder.Assignment.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentsResponse}
 */
proto.codegrinder.GetAssignmentsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentsResponse;
  return proto.codegrinder.GetAssignmentsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentsResponse}
 */
proto.codegrinder.GetAssignmentsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Assignment;
      reader.readMessage(value,proto.codegrinder.Assignment.deserializeBinaryFromReader);
      msg.addAssignments(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAssignmentsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.codegrinder.Assignment.serializeBinaryToWriter
    );
  }
};


/**
 * repeated Assignment assignments = 1;
 * @return {!Array<!proto.codegrinder.Assignment>}
 */
proto.codegrinder.GetAssignmentsResponse.prototype.getAssignmentsList = function() {
  return /** @type{!Array<!proto.codegrinder.Assignment>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.codegrinder.Assignment, 1));
};


/**
 * @param {!Array<!proto.codegrinder.Assignment>} value
 * @return {!proto.codegrinder.GetAssignmentsResponse} returns this
*/
proto.codegrinder.GetAssignmentsResponse.prototype.setAssignmentsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.codegrinder.Assignment=} opt_value
 * @param {number=} opt_index
 * @return {!proto.codegrinder.Assignment}
 */
proto.codegrinder.GetAssignmentsResponse.prototype.addAssignments = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.codegrinder.Assignment, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.codegrinder.GetAssignmentsResponse} returns this
 */
proto.codegrinder.GetAssignmentsResponse.prototype.clearAssignmentsList = function() {
  return this.setAssignmentsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
assignmentId: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentRequest}
 */
proto.codegrinder.GetAssignmentRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentRequest;
  return proto.codegrinder.GetAssignmentRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentRequest}
 */
proto.codegrinder.GetAssignmentRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setAssignmentId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getAssignmentId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetAssignmentRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetAssignmentRequest} returns this
 */
proto.codegrinder.GetAssignmentRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 assignment_id = 2;
 * @return {number}
 */
proto.codegrinder.GetAssignmentRequest.prototype.getAssignmentId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentRequest} returns this
 */
proto.codegrinder.GetAssignmentRequest.prototype.setAssignmentId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
assignment: (f = msg.getAssignment()) && proto.codegrinder.Assignment.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentResponse}
 */
proto.codegrinder.GetAssignmentResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentResponse;
  return proto.codegrinder.GetAssignmentResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentResponse}
 */
proto.codegrinder.GetAssignmentResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Assignment;
      reader.readMessage(value,proto.codegrinder.Assignment.deserializeBinaryFromReader);
      msg.setAssignment(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAssignment();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Assignment.serializeBinaryToWriter
    );
  }
};


/**
 * optional Assignment assignment = 1;
 * @return {?proto.codegrinder.Assignment}
 */
proto.codegrinder.GetAssignmentResponse.prototype.getAssignment = function() {
  return /** @type{?proto.codegrinder.Assignment} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Assignment, 1));
};


/**
 * @param {?proto.codegrinder.Assignment|undefined} value
 * @return {!proto.codegrinder.GetAssignmentResponse} returns this
*/
proto.codegrinder.GetAssignmentResponse.prototype.setAssignment = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetAssignmentResponse} returns this
 */
proto.codegrinder.GetAssignmentResponse.prototype.clearAssignment = function() {
  return this.setAssignment(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetAssignmentResponse.prototype.hasAssignment = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentProblemCommitLastRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
assignmentId: jspb.Message.getFieldWithDefault(msg, 2, 0),
problemId: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastRequest}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentProblemCommitLastRequest;
  return proto.codegrinder.GetAssignmentProblemCommitLastRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastRequest}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setAssignmentId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentProblemCommitLastRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getAssignmentId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 assignment_id = 2;
 * @return {number}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.getAssignmentId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.setAssignmentId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 problem_id = 3;
 * @return {number}
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemCommitLastRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentProblemCommitLastResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
commit: (f = msg.getCommit()) && proto.codegrinder.Commit.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastResponse}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentProblemCommitLastResponse;
  return proto.codegrinder.GetAssignmentProblemCommitLastResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastResponse}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Commit;
      reader.readMessage(value,proto.codegrinder.Commit.deserializeBinaryFromReader);
      msg.setCommit(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentProblemCommitLastResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentProblemCommitLastResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCommit();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Commit.serializeBinaryToWriter
    );
  }
};


/**
 * optional Commit commit = 1;
 * @return {?proto.codegrinder.Commit}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.getCommit = function() {
  return /** @type{?proto.codegrinder.Commit} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Commit, 1));
};


/**
 * @param {?proto.codegrinder.Commit|undefined} value
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastResponse} returns this
*/
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.setCommit = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetAssignmentProblemCommitLastResponse} returns this
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.clearCommit = function() {
  return this.setCommit(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetAssignmentProblemCommitLastResponse.prototype.hasCommit = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
assignmentId: jspb.Message.getFieldWithDefault(msg, 2, 0),
problemId: jspb.Message.getFieldWithDefault(msg, 3, 0),
step: jspb.Message.getFieldWithDefault(msg, 4, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentProblemStepCommitLastRequest;
  return proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setAssignmentId(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setStep(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getAssignmentId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      3,
      f
    );
  }
  f = message.getStep();
  if (f !== 0) {
    writer.writeInt64(
      4,
      f
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 assignment_id = 2;
 * @return {number}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.getAssignmentId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.setAssignmentId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional int64 problem_id = 3;
 * @return {number}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};


/**
 * optional int64 step = 4;
 * @return {number}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.getStep = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastRequest} returns this
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastRequest.prototype.setStep = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
commit: (f = msg.getCommit()) && proto.codegrinder.Commit.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.GetAssignmentProblemStepCommitLastResponse;
  return proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.Commit;
      reader.readMessage(value,proto.codegrinder.Commit.deserializeBinaryFromReader);
      msg.setCommit(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCommit();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.Commit.serializeBinaryToWriter
    );
  }
};


/**
 * optional Commit commit = 1;
 * @return {?proto.codegrinder.Commit}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.getCommit = function() {
  return /** @type{?proto.codegrinder.Commit} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.Commit, 1));
};


/**
 * @param {?proto.codegrinder.Commit|undefined} value
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse} returns this
*/
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.setCommit = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.GetAssignmentProblemStepCommitLastResponse} returns this
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.clearCommit = function() {
  return this.setCommit(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.GetAssignmentProblemStepCommitLastResponse.prototype.hasCommit = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemBundleUnconfirmedRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedRequest}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemBundleUnconfirmedRequest;
  return proto.codegrinder.PostProblemBundleUnconfirmedRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedRequest}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemBundleUnconfirmedRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} returns this
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ProblemBundle bundle = 2;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 2));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} returns this
*/
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedRequest} returns this
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemBundleUnconfirmedRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemBundleUnconfirmedResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedResponse}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemBundleUnconfirmedResponse;
  return proto.codegrinder.PostProblemBundleUnconfirmedResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedResponse}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemBundleUnconfirmedResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemBundleUnconfirmedResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemBundle bundle = 1;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 1));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedResponse} returns this
*/
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemBundleUnconfirmedResponse} returns this
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemBundleUnconfirmedResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemBundleConfirmedRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemBundleConfirmedRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedRequest}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemBundleConfirmedRequest;
  return proto.codegrinder.PostProblemBundleConfirmedRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemBundleConfirmedRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedRequest}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemBundleConfirmedRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemBundleConfirmedRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PostProblemBundleConfirmedRequest} returns this
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ProblemBundle bundle = 2;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 2));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemBundleConfirmedRequest} returns this
*/
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedRequest} returns this
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemBundleConfirmedRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemBundleConfirmedResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemBundleConfirmedResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedResponse}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemBundleConfirmedResponse;
  return proto.codegrinder.PostProblemBundleConfirmedResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemBundleConfirmedResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedResponse}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemBundleConfirmedResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemBundleConfirmedResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemBundle bundle = 1;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 1));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemBundleConfirmedResponse} returns this
*/
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemBundleConfirmedResponse} returns this
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemBundleConfirmedResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PutProblemBundleRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PutProblemBundleRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemBundleRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
problemId: jspb.Message.getFieldWithDefault(msg, 2, 0),
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PutProblemBundleRequest}
 */
proto.codegrinder.PutProblemBundleRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PutProblemBundleRequest;
  return proto.codegrinder.PutProblemBundleRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PutProblemBundleRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PutProblemBundleRequest}
 */
proto.codegrinder.PutProblemBundleRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt64());
      msg.setProblemId(value);
      break;
    case 3:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PutProblemBundleRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PutProblemBundleRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemBundleRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProblemId();
  if (f !== 0) {
    writer.writeInt64(
      2,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PutProblemBundleRequest} returns this
 */
proto.codegrinder.PutProblemBundleRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int64 problem_id = 2;
 * @return {number}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.getProblemId = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.codegrinder.PutProblemBundleRequest} returns this
 */
proto.codegrinder.PutProblemBundleRequest.prototype.setProblemId = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional ProblemBundle bundle = 3;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 3));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PutProblemBundleRequest} returns this
*/
proto.codegrinder.PutProblemBundleRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PutProblemBundleRequest} returns this
 */
proto.codegrinder.PutProblemBundleRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PutProblemBundleRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 3) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PutProblemBundleResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PutProblemBundleResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PutProblemBundleResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemBundleResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PutProblemBundleResponse}
 */
proto.codegrinder.PutProblemBundleResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PutProblemBundleResponse;
  return proto.codegrinder.PutProblemBundleResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PutProblemBundleResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PutProblemBundleResponse}
 */
proto.codegrinder.PutProblemBundleResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemBundle;
      reader.readMessage(value,proto.codegrinder.ProblemBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PutProblemBundleResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PutProblemBundleResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PutProblemBundleResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemBundleResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemBundle bundle = 1;
 * @return {?proto.codegrinder.ProblemBundle}
 */
proto.codegrinder.PutProblemBundleResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemBundle, 1));
};


/**
 * @param {?proto.codegrinder.ProblemBundle|undefined} value
 * @return {!proto.codegrinder.PutProblemBundleResponse} returns this
*/
proto.codegrinder.PutProblemBundleResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PutProblemBundleResponse} returns this
 */
proto.codegrinder.PutProblemBundleResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PutProblemBundleResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemSetBundleRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemSetBundleRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemSetBundleRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemSetBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemSetBundleRequest}
 */
proto.codegrinder.PostProblemSetBundleRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemSetBundleRequest;
  return proto.codegrinder.PostProblemSetBundleRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemSetBundleRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemSetBundleRequest}
 */
proto.codegrinder.PostProblemSetBundleRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.ProblemSetBundle;
      reader.readMessage(value,proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemSetBundleRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemSetBundleRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemSetBundleRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PostProblemSetBundleRequest} returns this
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ProblemSetBundle bundle = 2;
 * @return {?proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemSetBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSetBundle, 2));
};


/**
 * @param {?proto.codegrinder.ProblemSetBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemSetBundleRequest} returns this
*/
proto.codegrinder.PostProblemSetBundleRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemSetBundleRequest} returns this
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemSetBundleRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostProblemSetBundleResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostProblemSetBundleResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostProblemSetBundleResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemSetBundleResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemSetBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostProblemSetBundleResponse}
 */
proto.codegrinder.PostProblemSetBundleResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostProblemSetBundleResponse;
  return proto.codegrinder.PostProblemSetBundleResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostProblemSetBundleResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostProblemSetBundleResponse}
 */
proto.codegrinder.PostProblemSetBundleResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSetBundle;
      reader.readMessage(value,proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostProblemSetBundleResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostProblemSetBundleResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostProblemSetBundleResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostProblemSetBundleResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemSetBundle bundle = 1;
 * @return {?proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.PostProblemSetBundleResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemSetBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSetBundle, 1));
};


/**
 * @param {?proto.codegrinder.ProblemSetBundle|undefined} value
 * @return {!proto.codegrinder.PostProblemSetBundleResponse} returns this
*/
proto.codegrinder.PostProblemSetBundleResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostProblemSetBundleResponse} returns this
 */
proto.codegrinder.PostProblemSetBundleResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostProblemSetBundleResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PutProblemSetBundleRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PutProblemSetBundleRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemSetBundleRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemSetBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PutProblemSetBundleRequest}
 */
proto.codegrinder.PutProblemSetBundleRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PutProblemSetBundleRequest;
  return proto.codegrinder.PutProblemSetBundleRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PutProblemSetBundleRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PutProblemSetBundleRequest}
 */
proto.codegrinder.PutProblemSetBundleRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.ProblemSetBundle;
      reader.readMessage(value,proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PutProblemSetBundleRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PutProblemSetBundleRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemSetBundleRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PutProblemSetBundleRequest} returns this
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ProblemSetBundle bundle = 2;
 * @return {?proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemSetBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSetBundle, 2));
};


/**
 * @param {?proto.codegrinder.ProblemSetBundle|undefined} value
 * @return {!proto.codegrinder.PutProblemSetBundleRequest} returns this
*/
proto.codegrinder.PutProblemSetBundleRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PutProblemSetBundleRequest} returns this
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PutProblemSetBundleRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PutProblemSetBundleResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PutProblemSetBundleResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PutProblemSetBundleResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemSetBundleResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.ProblemSetBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PutProblemSetBundleResponse}
 */
proto.codegrinder.PutProblemSetBundleResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PutProblemSetBundleResponse;
  return proto.codegrinder.PutProblemSetBundleResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PutProblemSetBundleResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PutProblemSetBundleResponse}
 */
proto.codegrinder.PutProblemSetBundleResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.ProblemSetBundle;
      reader.readMessage(value,proto.codegrinder.ProblemSetBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PutProblemSetBundleResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PutProblemSetBundleResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PutProblemSetBundleResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PutProblemSetBundleResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.ProblemSetBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProblemSetBundle bundle = 1;
 * @return {?proto.codegrinder.ProblemSetBundle}
 */
proto.codegrinder.PutProblemSetBundleResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.ProblemSetBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.ProblemSetBundle, 1));
};


/**
 * @param {?proto.codegrinder.ProblemSetBundle|undefined} value
 * @return {!proto.codegrinder.PutProblemSetBundleResponse} returns this
*/
proto.codegrinder.PutProblemSetBundleResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PutProblemSetBundleResponse} returns this
 */
proto.codegrinder.PutProblemSetBundleResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PutProblemSetBundleResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostCommitBundlesUnsignedRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedRequest}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostCommitBundlesUnsignedRequest;
  return proto.codegrinder.PostCommitBundlesUnsignedRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedRequest}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostCommitBundlesUnsignedRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedRequest} returns this
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional CommitBundle bundle = 2;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 2));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedRequest} returns this
*/
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedRequest} returns this
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostCommitBundlesUnsignedRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostCommitBundlesUnsignedResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedResponse}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostCommitBundlesUnsignedResponse;
  return proto.codegrinder.PostCommitBundlesUnsignedResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedResponse}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostCommitBundlesUnsignedResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostCommitBundlesUnsignedResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional CommitBundle bundle = 1;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 1));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedResponse} returns this
*/
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostCommitBundlesUnsignedResponse} returns this
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostCommitBundlesUnsignedResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostCommitBundlesSignedRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostCommitBundlesSignedRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesSignedRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
sessionCookie: jspb.Message.getFieldWithDefault(msg, 1, ""),
bundle: (f = msg.getBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostCommitBundlesSignedRequest}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostCommitBundlesSignedRequest;
  return proto.codegrinder.PostCommitBundlesSignedRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostCommitBundlesSignedRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostCommitBundlesSignedRequest}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSessionCookie(value);
      break;
    case 2:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostCommitBundlesSignedRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostCommitBundlesSignedRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesSignedRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSessionCookie();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional string session_cookie = 1;
 * @return {string}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.getSessionCookie = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.codegrinder.PostCommitBundlesSignedRequest} returns this
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.setSessionCookie = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional CommitBundle bundle = 2;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 2));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.PostCommitBundlesSignedRequest} returns this
*/
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostCommitBundlesSignedRequest} returns this
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostCommitBundlesSignedRequest.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.codegrinder.PostCommitBundlesSignedResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.codegrinder.PostCommitBundlesSignedResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesSignedResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
bundle: (f = msg.getBundle()) && proto.codegrinder.CommitBundle.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.codegrinder.PostCommitBundlesSignedResponse}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.codegrinder.PostCommitBundlesSignedResponse;
  return proto.codegrinder.PostCommitBundlesSignedResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.codegrinder.PostCommitBundlesSignedResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.codegrinder.PostCommitBundlesSignedResponse}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.codegrinder.CommitBundle;
      reader.readMessage(value,proto.codegrinder.CommitBundle.deserializeBinaryFromReader);
      msg.setBundle(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.codegrinder.PostCommitBundlesSignedResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.codegrinder.PostCommitBundlesSignedResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.codegrinder.PostCommitBundlesSignedResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBundle();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.codegrinder.CommitBundle.serializeBinaryToWriter
    );
  }
};


/**
 * optional CommitBundle bundle = 1;
 * @return {?proto.codegrinder.CommitBundle}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.getBundle = function() {
  return /** @type{?proto.codegrinder.CommitBundle} */ (
    jspb.Message.getWrapperField(this, proto.codegrinder.CommitBundle, 1));
};


/**
 * @param {?proto.codegrinder.CommitBundle|undefined} value
 * @return {!proto.codegrinder.PostCommitBundlesSignedResponse} returns this
*/
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.setBundle = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.codegrinder.PostCommitBundlesSignedResponse} returns this
 */
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.clearBundle = function() {
  return this.setBundle(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.codegrinder.PostCommitBundlesSignedResponse.prototype.hasBundle = function() {
  return jspb.Message.getField(this, 1) != null;
};


goog.object.extend(exports, proto.codegrinder);
