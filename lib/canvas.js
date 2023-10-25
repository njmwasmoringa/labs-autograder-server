const axios = require("axios");

module.exports = axios.create({
    baseURL:"https://moringa.instructure.com/api/v1"
});