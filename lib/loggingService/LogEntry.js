// The LogEntry class represents a single log entry.
// It is the thing that gets emitted each time a user logs something, and contains an efficient
// API for passing context, details and data.

var cluster = require('cluster');
var util = require('util');
var rootPath = process.cwd();

var IncomingMessage = require('http').IncomingMessage;
var ServerResponse = require('http').ServerResponse;


function serializeAny(obj, refList) {
	var out;

	refList = refList || [];

	if (Array.isArray(obj)) {
		if (refList.indexOf(obj) !== -1) {
			return '[Circular reference]';
		}

		refList.push(obj);

		var len = obj.length;

		out = new Array(len);

		for (var i = 0; i < len; i++) {
			out[i] = serializeAny(obj[i], refList);
		}

		return out;
	}

	if (obj && typeof obj === 'object') {
		if (refList.indexOf(obj) !== -1) {
			return '[Circular reference]';
		}

		refList.push(obj);

		// class: Buffer

		if (Buffer.isBuffer(obj)) {
			return '[Buffer (' + obj.length + ' bytes)]';
		}

		// class: RegExp

		if (obj instanceof RegExp) {
			return '[RegExp (' + obj.toString() + ')]';
		}

		// class: IncomingMessage (incoming http requests and responses to outgoing http requests)

		if (obj instanceof IncomingMessage) {
			obj = {
				httpVersion: obj.httpVersion,
				method: obj.method,
				url: obj.url,
				headers: obj.headers,
				remoteAddress: obj.connection && obj.connection.remoteAddress
			};
		}

		// class: ServerResponse

		if (obj instanceof ServerResponse) {
			obj = {
				status: obj.statusCode
			};
		}

		// normal object

		out = {};

		for (var key in obj) {
			if (obj.hasOwnProperty(key)) {
				out[key] = serializeAny(obj[key] ? obj[key].valueOf() : obj[key], refList);
			}
		}

		return out;
	}

	// scalar

	return obj;
}


function LogEntry(channel) {
	this.timestamp = new Date();
	this.pid = process.pid;
	this.role = cluster.isMaster ? 'm' : 'w';
	this.channel = channel;
	this.contexts = null;
	this.message = null;
	this.details = null;
	this.data = null;
}


LogEntry.prototype.registerErrorDetails = function (error) {
	// the stack trace and other error information will be moved into the data object

	// turn the stack string into an array, stripped from its noisy whitespace

	var stack = error.stack && error.stack.split(/\s*\n\s*at\s+/);
	if (!stack || stack.length <= 1) {
		return;
	}

	// remove the first line: "Error: name", leaving only stack frames

	stack.shift();

	this.data = this.data || {};

	// assign all the data to the data object (custom errors may have some)
	Object.assign(this.data, error);

	// Remove message, we already display it in the log text
	delete this.data.message;

	// reformat the stack

	var locationFound = false;

	for (var i = 0; i < stack.length; i += 1) {
		// make the file path relative to the project

		stack[i] = stack[i].replace(rootPath + '/', '');

		// If the error did not originate in a native function (like JSON.parse), the top stack
		// frame should carry file, line and character offset information. While we're looking
		// at a native function, we move on to the next stack frame to get us closest to the
		// source of the error in user-land code.

		if (!locationFound) {
			var m = stack[i].match(/([\w\.]+):([0-9]+):([0-9]+)/);
			if (m) {
				locationFound = true;

				this.data.file = m[1];
				this.data.line = parseInt(m[2], 10) || 0;
				this.data.offset = parseInt(m[3], 10) || 0;
			}
		}
	}

	if (error.code) {
		this.data.code = error.code;
	}

	this.data.type = error.name;
	this.data.stack = stack;
};


LogEntry.prototype.serializeArgument = function (arg) {
	if (arg instanceof Error) {
		this.registerErrorDetails(arg);

		arg = arg.message;
	}

	if (arg === undefined) {
		return 'undefined';
	}

	if (typeof arg === 'string') {
		return arg;
	}

	// regexp

	if (arg instanceof RegExp) {
		return arg.toString();
	}

	// object stringification

	try {
		return JSON.stringify(arg);	// may fail because of circular references
	} catch (e) {
		return util.inspect(arg);   // yields multiline strings, much more readable than JSON for stack traces etc...
	}
};


LogEntry.prototype.serializeArguments = function (args) {
	var str;

	for (var i = 0, len = args.length; i < len; i++) {
		var arg = this.serializeArgument(args[i]);

		if (str) {
			str += ' ' + arg;
		} else {
			str = arg;
		}
	}

	return str;
};


LogEntry.prototype.addMessageArgs = function (args) {
	var str = this.serializeArguments(args);

	if (this.message) {
		this.message += ' ' + str;
	} else {
		this.message = str;
	}
};


LogEntry.prototype.addContexts = function (args) {
	if (this.contexts) {
		this.contexts.push.apply(this.contexts, args);
	} else {
		this.contexts = Array.prototype.slice.call(args);
	}
};


LogEntry.prototype.addDetails = function (args) {
	var str = this.serializeArguments(args);

	if (this.details) {
		this.details.push(str);
	} else {
		this.details = [str];
	}
};


LogEntry.prototype.addData = function (data) {
	data = serializeAny(data);

	if (this.data) {
		for (var key in data) {
			if (data.hasOwnProperty(key)) {
				this.data[key] = data[key];
			}
		}
	} else {
		this.data = data;
	}
};


module.exports = LogEntry;
