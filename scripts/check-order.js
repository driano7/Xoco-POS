const fs = require('fs');
const [,, id] = process.argv;
if (!id) { console.error('Usage: node scripts/check-order.js order.json'); process.exit(1);} 
const data = JSON.parse(fs.readFileSync(id,'utf-8'));
console.log(JSON.stringify({shipping:data?.shipping,total:data?.total},null,2));
