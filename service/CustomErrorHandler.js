

class CustomErrorHandler extends Error{

    constructor(status,msg){
        super();
        this.status = status;
        this.message = msg;
    }


    static alreadyExist(message) {
        return new CustomErrorHandler(409,message);
    }

    static doesNotExist(message = "User Does Not Exists") {
        return new CustomErrorHandler(400,message);
    }

    static wrongCredentials(message = "Wrong Credential") {
        return new CustomErrorHandler(401,message);
    }

    static unAuthorise(message = "UnAuthorise") {
        return new CustomErrorHandler(401,message);
    }

    static wrongApi(message = "Invalid API key") {
        return new CustomErrorHandler(401,message);
    }

    static notFound(message = "404 Not Found") {
        return new CustomErrorHandler(404,message);
    }
}


export default CustomErrorHandler;