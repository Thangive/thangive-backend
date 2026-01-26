import fs from 'fs-extra'
import { SERVER_HOST } from '../config/index.js';

const commonFuction = {
    moveFiles(src, dest) {
        let path = (SERVER_HOST === "true") ? '../www/html/adis.co.in/cow_assets/' : 'uploads/';
        dest = path + dest;
        src = path + src;
        fs.pathExists(dest, (err, exists) => {
            if (!err) {
                if (exists) {
                    fs.remove(dest, err => {
                        if (err) return console.error(err)
                        console.log('removed success!');
                        commonFuction.moveFiles(src, dest);
                    })
                } else {
                    fs.move(src, dest, err => {
                        if (err) return console.error(err)
                        console.log('move success!')
                    })
                }
            }
            else {
                return false;
            }
        })
    },

    getFiles(src) {
        fs.pathExists(src, (err, exists) => {
            if (!err) {
                if (exists) {
                    fs.readdir(src, (err, files) => {
                        if (err) {
                            return false
                        } else {
                            return excelFiles = files.filter(file => path.extname(file).toLowerCase() === '.xlsx');
                        }
                    });
                }
            }
        });
    }

}




export default commonFuction;