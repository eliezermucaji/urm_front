const express = require('express');
const app = express();

const path = require('path')


app.use(express.static(path.join(__dirname, "public")));

app.get('/', (req, res)=>{
 res.sendFile(__dirname+'/public/dashboard.html');
})

app.get('/comparacao', (req, res)=>{
 res.sendFile(__dirname+'/public/comparacao.html');
})

app.get('/editor', (req, res)=>{
 res.sendFile(__dirname+'/public/editor.html');
})

app.get('/educacao', (req, res)=>{
 res.sendFile(__dirname+'/public/education.html');
})

app.get('/perguntas', (req, res)=>{
 res.sendFile(__dirname+'/public/perguntas.html');
})

app.use((req, res)=>{
    res.sendFile(__dirname+'/public/404.html');
});
module.exports = app;
