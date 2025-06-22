const express = require('express')
const app = express()
const port = process.env.PORT || 3000
const bodyParser = require('body-parser')
const authToken = process.env.authToken || null
const cors = require('cors')
const reqValidate = require('./module/reqValidate')
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');

global.browserLength = 0
global.browserLimit = Number(process.env.browserLimit) || 20
global.timeOut = Number(process.env.timeOut || 60000)

app.use(bodyParser.json({}))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())
if (process.env.NODE_ENV !== 'development') {
    let server = app.listen(port, () => { console.log(`Server running on port ${port}`) })
    try {
        server.timeout = global.timeOut
    } catch (e) { }
}
if (process.env.SKIP_LAUNCH != 'true') require('./module/createBrowser')

const getSource = require('./endpoints/getSource')
const solveTurnstileMin = require('./endpoints/solveTurnstile.min')
const solveTurnstileMax = require('./endpoints/solveTurnstile.max')
const wafSession = require('./endpoints/wafSession')

app.post('/scrape', async (req, res) => {
    const { url, headers, body, type, proxy } = req.body;
  
    if (!url || !type) {
      return res.status(400).json({ error: 'url and type (method) are required' });
    }
  
    let axiosConfig = {
      method: type.toLowerCase(),
      url,
      headers: headers || {},
      data: body || {},
      timeout: 30000,
      responseType: 'stream', // <= ده مهم جدا
      validateStatus: () => true,
    };
  
    if (proxy && proxy.host && proxy.port) {
      let proxyAuth = '';
      if (proxy.username && proxy.password) {
        proxyAuth = `${proxy.username}:${proxy.password}@`;
      }
      const proxyUrl = `http://${proxyAuth}${proxy.host}:${proxy.port}`;
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
      axiosConfig.proxy = false;
    }
  
    try {
      const response = await axios(axiosConfig);
  
      res.status(response.status);

    // ابعت نفس headers
    for (let key in response.headers) {
      res.setHeader(key, response.headers[key]);
    }

    // ابعت ال body زى ما هو
    response.data.pipe(res);

    //   console.log(response.headers['content-type']);
    //   console.log(typeof response.data);
    //   console.log(response.data.slice(0, 500)); // first 500 chars
  
    //   let rawData = response.data;
    //   let parsedChunks = [];
  
    //   // Detect amazon streaming content-type
    //   const isAmazonStreaming = (response.headers['content-type'] || '').includes('application/json-amazonui-streaming');
  
    //   if (isAmazonStreaming) {
    //     // split by &&& and parse each part
    //     parsedChunks = rawData
    //       .split('&&&')
    //       .map(part => part.trim())
    //       .filter(part => part.length > 0)
    //       .map(part => {
    //         try {
    //           return JSON.parse(part);
    //         } catch (err) {
    //           console.error('JSON parse error on part:', part.slice(0, 100), err);
    //           return null;
    //         }
    //       })
    //       .filter(item => item !== null);
    //   }
  

    //   res.status(response.status).json({
    //     status: response.status,
    //     statusText: response.statusText,
    //     headers: response.headers,
    //     data: isAmazonStreaming ? parsedChunks : rawData,
    //   });
    } catch (error) {
      res.status(500).json({
        error: error.message,
        details: error.response ? error.response.data : null,
      });
    }
  });

app.post('/cf-clearance-scraper', async (req, res) => {

    const data = req.body

    const check = reqValidate(data)

    if (check !== true) return res.status(400).json({ code: 400, message: 'Bad Request', schema: check })

    if (authToken && data.authToken !== authToken) return res.status(401).json({ code: 401, message: 'Unauthorized' })

    if (global.browserLength >= global.browserLimit) return res.status(429).json({ code: 429, message: 'Too Many Requests' })

    if (process.env.SKIP_LAUNCH != 'true' && !global.browser) return res.status(500).json({ code: 500, message: 'The scanner is not ready yet. Please try again a little later.' })

    var result = { code: 500 }

    global.browserLength++

    switch (data.mode) {
        case "source":
            result = await getSource(data).then(res => { return { source: res, code: 200 } }).catch(err => { return { code: 500, message: err.message } })
            break;
        case "turnstile-min":
            result = await solveTurnstileMin(data).then(res => { return { token: res, code: 200 } }).catch(err => { return { code: 500, message: err.message } })
            break;
        case "turnstile-max":
            result = await solveTurnstileMax(data).then(res => { return { token: res, code: 200 } }).catch(err => { return { code: 500, message: err.message } })
            break;
        case "waf-session":
            result = await wafSession(data).then(res => { return { ...res, code: 200 } }).catch(err => { return { code: 500, message: err.message } })
            break;
    }

    global.browserLength--

    res.status(result.code ?? 500).send(result)
})

app.use((req, res) => { res.status(404).json({ code: 404, message: 'Not Found' }) })

if (process.env.NODE_ENV == 'development') module.exports = app
