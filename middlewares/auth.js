import { CustomErrorHandler, JwtService } from "../service/index.js";
const auth = async (req, res, next) => {
    let authHeader = req.headers.authorization;

    if (!authHeader) {
        return next(CustomErrorHandler.unAuthorise());
    }

    const token = authHeader.split(' ')[1];
    // console.log(token);
    try {
        const { _id, role } = await JwtService.verify(token);
        const user = {
            _id,
            role
        }
        req.user = user;
        next();

    } catch (err) {
        return next(CustomErrorHandler.unAuthorise(err.message));
        // return next(err);
    }

}

export default auth;