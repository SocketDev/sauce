const _ = require('lodash')
const express = require('express')

const app = express()

app.get('/', (req, res) => {
  const data = { message: 'hello', items: [3, 1, 2] }
  res.json({
    message: data.message,
    sorted: _.sortBy(data.items),
  })
})

module.exports = app
