class CustomErrorHandler extends Error {

    constructor(statusCode, message) {
        super();
        this.statusCode = statusCode;
        this.message = message;
        this.status = false;   // 👈 ALWAYS false for errors
    }

    static alreadyExist(message) {
        return new CustomErrorHandler(409, message);
    }

    static doesNotExist(message = "User Does Not Exists") {
        return new CustomErrorHandler(400, message);
    }

    static wrongCredentials(message = "Wrong Credential") {
        return new CustomErrorHandler(401, message);
    }

    static unAuthorise(message = "UnAuthorise") {
        return new CustomErrorHandler(401, message);
    }

    static wrongApi(message = "Invalid API key") {
        return new CustomErrorHandler(401, message);
    }

    static notFound(message = "404 Not Found") {
        return new CustomErrorHandler(404, message);
    }

    static badRequest(message = "Bad Request") {
        return new CustomErrorHandler(400, message);
    }
}

export default CustomErrorHandler;
