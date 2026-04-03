import Joi from 'joi';
import { getData, insertData } from '../../config/index.js';
import { CustomErrorHandler } from "../../service/index.js";
import paginationQuery from '../../helper/paginationQuery.js';


const BlogController = {
    async addUpdateBlog(req, res, next) {
        try {
            // /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                blog_id: Joi.number().integer().optional(),
                title: Joi.string().required(),
                description: Joi.string().required(),
                youtubLink: Joi.string().allow('', null).optional(),
                keyword: Joi.string().allow('', null).optional(),
                stockID: Joi.number().optional(),
                publishdate: Joi.date().optional(),
                readtime: Joi.string().optional(),
                sourceURL: Joi.string().allow('', null).optional(),
                sourceName: Joi.string().allow('', null).optional(),
                existing_images: Joi.string().optional(),
                draft: Joi.number().optional(),
                role_id: Joi.number().required()
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const dataObj = {
                title: req.body.title,
                description: req.body.description,
                youtubLink: req.body.youtubLink,
                keyword: req.body.keyword,
                stockID: req.body.stockID,
                publishdate: req.body.publishdate,
                readtime: req.body.readtime,
                sourceURL: req.body.sourceURL,
                sourceName: req.body.sourceName,
                draft: req.body.draft || 0,
                role_id: req.body.role_id,
                updated_at: new Date()
            };

            /* ---------------- IMAGE HANDLING ---------------- */
            let finalGallery = [];

            // OLD images
            if (req.body.existing_images) {
                try {
                    finalGallery = JSON.parse(req.body.existing_images);
                } catch (e) {
                    finalGallery = [];
                }
            }

            // NEW uploaded images
            if (req.files && req.files.blogImages?.length > 0) {
                const newImages = req.files.blogImages.map(
                    file => `uploads/upload/${file.filename}`
                );
                finalGallery = [...finalGallery, ...newImages];
            }

            dataObj.blogImages = JSON.stringify(finalGallery);

            if (req.files && req.files.sourceAttachment?.length > 0) {
                dataObj.sourceAttachment = `uploads/upload/${req.files.sourceAttachment[0].filename}`;
            }

            if (!req.body.blog_id) {
                dataObj.created_at = new Date();
            }

            /* ---------------- INSERT / UPDATE ---------------- */
            let query = "";
            if (req.body.blog_id) {
                query = `UPDATE blogArticle SET ? WHERE blog_id='${req.body.blog_id}'`;
            } else {
                query = `INSERT INTO blogArticle SET ?`;
            }

            const result = await insertData(query, dataObj, next);

            res.json({
                success: true,
                message: req.body.blog_id
                    ? "Blog updated successfully"
                    : "Blog published successfully",
            });

        } catch (error) {
            next(error);
        }
    },

    async addUpdateKeyword(req, res, next) {
        try {
            /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                name: Joi.string().required(),
                trending: Joi.string().optional(),
                important: Joi.string().optional(),
                is_deleted: Joi.string().optional(),
                role_id: Joi.number().optional(),
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            const name = req.body.name.replace(/'/g, "");

            /* ---------------- CHECK EXISTING ---------------- */
            let checkQuery = `
                SELECT keyword_id 
                FROM blogArticleKeyword 
                WHERE LOWER(name) = LOWER('${name}') 
                AND is_deleted = 0
            `;

            const existingKeyword = await getData(checkQuery, next);

            /* ---------------- DATA OBJECT ---------------- */
            const dataObj = {
                name: name,
                trending: req.body.trending || 0,
                important: req.body.important || 0,
                is_deleted: req.body.is_deleted || 0,
                updated_at: new Date()
            };

            let query = "";

            /* ---------------- UPDATE IF EXISTS ---------------- */
            if (existingKeyword && existingKeyword.length > 0) {
                const keyword_id = existingKeyword[0].keyword_id;

                query = `
                    UPDATE blogArticleKeyword 
                    SET ? 
                    WHERE keyword_id='${keyword_id}'
                `;

                await insertData(query, dataObj, next);

                if (dataObj.is_deleted == 1) {

                    /* ---------------- REMOVE KEYWORD FROM BLOGS ---------------- */
                    const keywordName = name;

                    const blogQuery = `
                        SELECT blog_id, keyword 
                        FROM blogArticle 
                        WHERE is_deleted = 0 
                        AND JSON_CONTAINS(keyword, JSON_QUOTE('${keywordName}'))
                    `;

                    const blogs = await getData(blogQuery, next);

                    for (let blog of blogs) {
                        let keywordArray = [];

                        try {
                            keywordArray = JSON.parse(blog.keyword);
                        } catch (e) {
                            continue;
                        }

                        // Remove keyword (case insensitive)
                        keywordArray = keywordArray.filter(
                            k => k.toLowerCase() !== keywordName.toLowerCase()
                        );

                        const updatedKeywords = JSON.stringify(keywordArray).replace(/'/g, "\\'");

                        const updateQuery = `
                            UPDATE blogArticle 
                            SET keyword = '${updatedKeywords}'
                            WHERE blog_id = ${blog.blog_id}
                        `;

                        await insertData(updateQuery, {}, next);
                    }
                }

                return res.json({
                    success: true,
                    message: "Keyword updated (matched by name)"
                });
            }

            /* ---------------- INSERT IF NOT EXISTS ---------------- */
            dataObj.created_at = new Date();

            query = `INSERT INTO blogArticleKeyword SET ?`;

            await insertData(query, dataObj, next);

            return res.json({
                success: true,
                message: "Keyword added successfully"
            });

        } catch (error) {
            next(error);
        }
    },

    async getKeywords(req, res, next) {
        try {
            const query = `
            SELECT keyword_id, name,important, trending 
            FROM blogArticleKeyword 
            WHERE is_deleted = 0
            ORDER BY name ASC
        `;

            const result = await getData(query, next);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            next(error);
        }
    },

    async getBlog(req, res, next) {
        try {
            /* ------------------ Base Query ------------------ */
            let query = `
            SELECT 
                b.blog_id,
                b.title,
                b.description,
                b.youtubLink,
                b.keyword,
                b.stockID,
                b.publishdate,
                b.readtime,
                b.sourceURL,
                b.sourceName,
                b.blogImages,
                b.sourceAttachment,
                b.draft,
                b.role_id,
                b.created_at,
                b.updated_at,
                s.company_name
            FROM blogArticle b
            LEFT JOIN stock_details s 
                ON b.stockID = s.stock_details_id
            WHERE b.is_deleted = 0
        `;

            let cond = '';
            let page = { pageQuery: '' };

            /* ------------------ Validation ------------------ */
            const schema = Joi.object({
                blog_id: Joi.number().integer(),
                title: Joi.string(),
                role_id: Joi.number().integer(),
                stockID: Joi.number().integer(),
                search: Joi.string(),
                keyword: Joi.string(),
                pagination: Joi.boolean(),
                current_page: Joi.number().integer(),
                per_page_records: Joi.number().integer(),
            });

            const { error } = schema.validate(req.query);
            if (error) return next(error);

            /* ------------------ Filters ------------------ */
            if (req.query.blog_id) {
                cond += ` AND b.blog_id = ${req.query.blog_id}`;
            }

            if (req.query.title) {
                cond += ` AND b.title LIKE '%${req.query.title}%'`;
            }

            if (req.query.role_id) {
                cond += ` AND b.role_id = ${req.query.role_id}`;
            }

            if (req.query.stockID) {
                cond += ` AND b.stockID = ${req.query.stockID}`;
            }

            if (req.query.search) {
                const search = req.query.search.toLowerCase();

                cond += `
                    AND (
                        LOWER(b.title) LIKE '%${search}%'
                        OR LOWER(b.keyword) LIKE '%${search}%'
                        OR LOWER(s.company_name) LIKE '%${search}%'
                    )
                `;
            }
            //LOWER(b.description) LIKE '%${search}%'

            if (req.query.keyword) {
                const keyword = req.query.keyword.toLowerCase();

                cond += `
                AND LOWER(b.keyword) LIKE '%"${keyword}"%'
            `;
            }

            /* ------------------ Pagination ------------------ */
            if (req.query.pagination) {
                page = await paginationQuery(
                    query + cond,
                    next,
                    req.query.current_page,
                    req.query.per_page_records
                );
            }

            query += cond + page.pageQuery;

            const data = await getData(query, next);

            return res.json({
                message: 'success',
                total_records: page.total_rec ?? data.length,
                number_of_pages: page.number_of_pages || 1,
                currentPage: page.currentPage || 1,
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },
    async RelatedBlog(req, res, next) {
        try {
            const schema = Joi.object({
                blog_id: Joi.number().integer().required(),
            });

            const { error } = schema.validate(req.query);
            if (error) return next(error);

            const blog_id = req.query.blog_id;

            /* ------------------ Get Keywords ------------------ */
            const blogQuery = `
            SELECT keyword 
            FROM blogArticle 
            WHERE blog_id = ${blog_id} AND is_deleted = 0
        `;

            const blogData = await getData(blogQuery, next);

            if (!blogData.length) {
                return res.json({ message: "No blog found", data: [] });
            }

            let keywords = blogData[0].keyword;

            if (!keywords) {
                return res.json({ message: "No keywords found", data: [] });
            }

            let keywordArray = [];

            try {
                keywordArray = JSON.parse(keywords);
            } catch (e) {
                return res.json({
                    message: "Invalid keyword format",
                    data: []
                });
            }

            if (!keywordArray.length) {
                return res.json({
                    message: "No related keywords found",
                    data: []
                });
            }

            /* ------------------ Build Condition ------------------ */
            let keywordCond = keywordArray.map(k =>
                `JSON_CONTAINS(b.keyword, '"${k}"')`
            ).join(' OR ');

            /* ------------------ Final Query ------------------ */
            const query = `
            SELECT 
                b.blog_id,
                b.title,
                b.description,
                b.keyword,
                b.publishdate,
                b.blogImages,
                s.company_name
            FROM blogArticle b
            LEFT JOIN stock_details s 
                ON b.stockID = s.stock_details_id
            WHERE 
                b.is_deleted = 0
                AND b.blog_id != ${blog_id}
                AND (${keywordCond})
            ORDER BY b.blog_id DESC
            LIMIT 10
        `;

            const data = await getData(query, next);

            return res.json({
                message: "success",
                records: data.length,
                data: data
            });

        } catch (err) {
            next(err);
        }
    },
    async addBlogBanner(req, res, next) {
        try {
            /* ---------------- VALIDATION ---------------- */
            const schema = Joi.object({
                // user sirf banner bhejega (file)
            });

            const { error } = schema.validate(req.body);
            if (error) return next(error);

            /* ---------------- FILE CHECK ---------------- */
            if (!req.files || !req.files.banner || req.files.banner.length === 0) {
                return res.json({
                    success: false,
                    message: "Banner image is required"
                });
            }

            const dataObj = {
                created_at: new Date()
            };

            /* ---------------- GET FILE PATH ---------------- */
            if (req.files && req.files.banner?.length > 0) {
                dataObj.banner = `uploads/upload/${req.files.banner[0].filename}`;
            }

            /* ---------------- DATA OBJECT ---------------- */

            /* ---------------- INSERT ---------------- */
            const query = `INSERT INTO blogADBanner SET ?`;

            await insertData(query, dataObj, next);

            return res.json({
                success: true,
                message: "Banner uploaded successfully"
            });

        } catch (error) {
            next(error);
        }
    },
    async getLatestBlogBanner(req, res, next) {
        try {
            /* ---------------- QUERY ---------------- */
            const query = `
            SELECT 
                blog_banenr_id,
                banner,
                created_at
            FROM blogADBanner
            WHERE is_deleted = 0
            ORDER BY blog_banenr_id DESC
            LIMIT 1
        `;

            const data = await getData(query, next);

            /* ---------------- RESPONSE ---------------- */
            if (!data.length) {
                return res.json({
                    success: false,
                    message: "No banner found",
                    data: null
                });
            }

            return res.json({
                success: true,
                message: "Banner fetched successfully",
                data: data[0]
            });

        } catch (error) {
            next(error);
        }
    }
}
export default BlogController;