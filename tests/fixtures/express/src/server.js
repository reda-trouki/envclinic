const express = require("express");
const app = express();
app.listen(process.env.PORT);
app.set("secret", process.env["SESSION_SECRET"]);
