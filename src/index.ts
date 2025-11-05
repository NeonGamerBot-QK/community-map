import "dotenv/config";
import express from "express";
import { readFileSync } from "fs";
import path from "path";
interface Data {
  lat: number;
  long: number;
  username: string;
  slackid: string;
}

const app = express();
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/mapdata", (req, res) => {
  // ability to load partially or for x,y,zoom
  const currentData: Data[] = JSON.parse(
    readFileSync("./data.json").toString(),
  ) as Data[];
  if (req.query.partial) {
    // 1/4 of it
    return res.json(currentData.slice(0, Math.round(currentData.length / 4)));
  }
  res.json(currentData);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Up`);
});
