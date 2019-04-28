/**
 * @license
 * Copyright Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// [START sheets_quickstart]
const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');

const WebSocket = require('ws');
const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);
var path = require('path');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

const SPREADSHEET_ID = '1V-SXHwL-H2ndHVC0j7NvH1qO_5I7XuLHoAP5ZU1ZUrw';
 
app.use(function (req, res, next) {
    console.log("GET:", req.url);
    next();
});
 
app.use(express.static('public'))

var wss = expressWs.getWss('/');
 
app.ws('/', function(ws, req) {
  ws.on('message', function(msg) {
    console.log('Received:', msg);
    // Load client secrets from a local file.
    fs.readFile('credentials.json', (err, content) => {
      if (err) return console.log('Error loading client secret file:', err);
      // Authorize a client with credentials, then call the Google Sheets API.
      if (msg == "") {
        authorize(JSON.parse(content), fetchInputsAndOutputs, ws, msg);
      } else {
        authorize(JSON.parse(content), processInputsAndFetchInputsAndOutputs, ws, msg);
      }
    });
  });
});
 
app.listen(8888);

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback, ws, msg) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback, ws, msg);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client, ws, msg);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback, ws, msg) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error while trying to retrieve access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client, ws, msg);
    });
  });
}

/**
 * Enter inputs into the model and reports the global inputs and outputs:
 * @see https://docs.google.com/spreadsheets/d/1V-SXHwL-H2ndHVC0j7NvH1qO_5I7XuLHoAP5ZU1ZUrw/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */
function processInputsAndFetchInputsAndOutputs(auth, ws, inputMsg) {
  const sheets = google.sheets({version: 'v4', auth});
  
  // Process Inputs
  var requestObject = JSON.parse(inputMsg);
  var team = requestObject['team'];
  var colBase = 'D'.charCodeAt(0);
  var colOffset = team.charCodeAt(0) - 'A'.charCodeAt(0);
  var col = String.fromCharCode(colBase + colOffset);
  var price = requestObject['price'];
  var sales = requestObject['sales'];
  var marketing = requestObject['marketing'];  
  let values = [
    [price],
    [sales],
    [marketing],
  ];
  const resource = {
    values,
  };
  sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Inputs!' + col + '6:' + col + '8',
    valueInputOption: 'USER_ENTERED',
    resource: resource,
  }, (err, result) => {
    if (err) {
      // Handle error
      console.log(err);
    }
    
    fetchInputsAndOutputs(auth, ws);
  });
}

function fetchInputsAndOutputs(auth, ws) {
  const sheets = google.sheets({version: 'v4', auth});
  
  var responseObj = {};
  // Fetch Inputs
  sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Inputs!C5:F8',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const rows = res.data.values;
    if (rows.length) {
      // Print columns A and E, which correspond to indices 0 and 4.
      responseObj['inputs'] = {};
      rows.map((row) => {
        responseObj['inputs'][row[0]] = [row[1], row[2], row[3]];
      });
    } else {
      console.log('No data found.');
    }
    
    // Fetch Outputs
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Outputs!C4:F7',
    }, (err, res) => {
      if (err) return console.log('The API returned an error: ' + err);
      const rows = res.data.values;
      if (rows.length) {
        // Print columns A and E, which correspond to indices 0 and 4.
        responseObj['outputs'] = {};
        rows.map((row) => {
          responseObj['outputs'][row[0]] = [row[1], row[2], row[3]];
        });
        
        var outputMsg = JSON.stringify(responseObj);
        wss.clients.forEach(function each(client) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(outputMsg);
          }
        });
        console.log('Sent:', outputMsg);
      } else {
        console.log('No data found.');
      }
    });
  });
}
// [END sheets_quickstart]

module.exports = {
  SCOPES,
  processInputsAndFetchInputsAndOutputs,
};
