import pkg from "joi";
import { DEBUG_MODE } from "../config/index.js";
import CustomErrorHandler from "../service/CustomErrorHandler.js";
const { ValidationError } = pkg;

const errorHandler = (err, req, res, next) => {

    let statusCode = 500;
    (DEBUG_MODE === "true") && console.log("Error", err);

    let data = {
        message: 'Internal server error',

        ...(DEBUG_MODE === "true" && {
            originalError:
                err instanceof Error
                    ? err.message
                    : typeof err === "object"
                        ? JSON.stringify(err)
                        : err
        })

    }

    if (err instanceof ValidationError) {
        statusCode = 422;
        data = {
            status: false,
            message: err.message
        }
    }

    if (err instanceof CustomErrorHandler) {
        statusCode = err.statusCode;
        data = {
            status: false,
            message: err.message
        }
    }

    return res.status(statusCode).json(data);

}

export default errorHandler;