import { getData } from "../config/index.js";

const paginationQuery = async (query,next,currentPage = 1,perPageRecords = 10,) =>{

    let total_rec = 0;
    currentPage == 0 && (currentPage = 1)
    query && await getData(query, next).then((data) => {
        total_rec = data.length;
    });

    let pageFirstResult = (currentPage - 1) * perPageRecords;

    let pageQuery = ' LIMIT ' + pageFirstResult + ', ' + perPageRecords + ' ';
    let number_of_pages = Math.ceil(parseInt(total_rec) / parseInt(perPageRecords));
    return {
        'total_rec' : total_rec,
        'pageQuery':pageQuery,
        'number_of_pages':number_of_pages,
        "currentPage" : parseInt(currentPage),
    };
}

export default paginationQuery;