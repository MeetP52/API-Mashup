const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const querystring = require('querystring');
const credentials = require('./Credentials/credentials.json');

const port = 3000;
const server = http.createServer();

const user_sessions = [];
server.listen(port);

server.on('listening', listener => {
    console.log(`Listening on port ${port}`);
});

server.on('request', (req,res) => {
    if(req.url === '/') {
        res.writeHead(200, "Ok", { 'Context-type': 'text/html' });
        fs.createReadStream('html/index.html').pipe(res);
    } else if (req.url.startsWith('/sign-in')) {
        const num = new URL(req.url, `https://${req.headers.host}`).searchParams.get('Quantity');
        if(num <= 0 || num > 1000) {
            res.writeHead(400, "Bad Request", { 'Context-type': 'text/html' });
            res.write(`<h1>400 Bad Request</h1>`);
            res.write(`<p>Bad Input</p>`);
            res.end();
        } else {
            res.writeHead(202, "Accepted", { 'Context-type': 'text/html' });

            const state = crypto.randomBytes(20).toString('hex');
            user_sessions.push({num,state});

            const auth_url = new URL(credentials.web.auth_uri);
            auth_url.search = new URLSearchParams({
                'client_id': credentials.web.client_id,
                'redirect_uri': credentials.web.redirect_uris.at(0),
                'response_type': 'code',
                'scope': 'https://www.googleapis.com/auth/drive',
                'state': state,
                'include_granted_scopes': true
            });

            res.writeHead(302, {Location: auth_url.href}).end();
        } 
    } else if (req.url.startsWith('/receive')) {
        const searcparams = new URL(req.url, `https://${req.headers.host}`).searchParams;
        const auth_code = searcparams.get('code');
        const state = searcparams.get('state');
        const params = querystring.stringify({
            client_id: credentials.web.client_id,
            client_secret: credentials.web.client_secret,
            code: auth_code,
            grant_type: 'authorization_code',
            redirect_uri: credentials.web.redirect_uris.at(0)
        });
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        let session = user_sessions.find(session => session.state === state);
        if (auth_code === undefined || state === undefined || session === undefined) {
            res.writeHead(404, "Not Found", { 'Context-type': 'text/html' });
            res.end("<h1>Not Found</h1>");
            return;
        }
        let num = session.num;
        console.log("Got User session");
        console.log("Got Auth Code");

        https.request(credentials.web.token_uri, options, token_obj => process_stream(token_obj, get_tokens, num, res)).end(params);
    } else {
        res.writeHead(404, "Not Found", { 'Context-type': 'text/html' });
        res.end("<h1>Not Found</h1>");
    }
})

function process_stream(stream, callback, ...rest) {
    let data = "";
    stream.on('data', chunk => data += chunk);
    stream.on('end', () => callback(data, ...rest));
}

function get_tokens(data, num, res) {
    const token = JSON.parse(data);
    let access_token = token.access_token;

    console.log("Got Access Token");
    const Dog_Facts = https.request(`https://dog-api.kinduff.com/api/facts?number=${num}`);
    Dog_Facts.on('response', incommingMessage_stream => process_stream(incommingMessage_stream, parse_data, access_token, res));
    Dog_Facts.end();
}

function parse_data(data, access_token, res) {
    const facts = JSON.parse(data);
    let fact_data = facts?.facts;
    console.log("Got Data");
    make_request(fact_data, access_token, res);
}

function make_request(data, access_token, res) {
    const facts = data;
    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };
    
    https.request('https://www.googleapis.com/drive/v3/files',options, file => process_stream(file,send_data,facts,access_token,res)).end(JSON.stringify({
        'name': 'Dog Facts.json'
    }));
}

function send_data(data,facts,access_token,res) {
    const file = JSON.parse(data);
    const file_id = file.id;
    console.log("Created File");
    const options = {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    https.request(`https://www.googleapis.com/upload/drive/v3/files/${file_id}?uploadType=media`,options, file_data => process_stream(file_data,show_data,file_id,res)).end(JSON.stringify(facts));
}

function show_data(data,file_id,res) {
    const File_data = JSON.parse(data);
    if(file_id === File_data.id) {
        console.log("Uploaded Data");
        res.writeHead(200,"ok", { 'Context-type': 'text/html' });
        res.write("<h1>Success</h1>");
        res.end();
    }
}