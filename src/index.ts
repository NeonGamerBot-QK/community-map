import "dotenv/config";
import express from "express";
import { readFileSync } from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path);

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/mapdata", (req, res) => {
  // ability to load partially or for x,y,zoom
  const currentData = readFileSync("./data.json");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Up`);
});
