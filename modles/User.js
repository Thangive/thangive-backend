import con from "../config/database.js"

class User {

  constructor() {
    this.error = "null";
  }



  

  runQuery(query) {
    con.query(query, function (err, result, fields) {
      if (err) {
        // error1.push(err.message);
        // errorDetect(err.message);
        this.error = err.message;
        console.log(this.error);
      } else {
        data = result;
      }

      // res.json({
      //   message: "Hello From Express",
      //   data: data,
      //   error: error1
      // })
    });
  }

  getResponce()
  {
    return this.error;
  }

}

export default User;