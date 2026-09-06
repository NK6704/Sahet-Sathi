const https = require('https');
const req = https.get('https://hem.nha.gov.in/', { rejectUnauthorized: false }, (res) => {
  let html = '';
  res.on('data', d => html += d);
  res.on('end', () => {
    console.log(html.match(/src=[\'\"]?([^\'\"\s>]+\.js)/g));
  });
});
req.end();
