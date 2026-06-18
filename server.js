const app = require('./app.js');
require('dotenv').config();
const PORT = process.env.PORT || 3000;

const init_server = ()=>{
  console.log(`Server connected on http://127.0.0.1:${PORT}`);
}


app.listen(PORT, init_server);
