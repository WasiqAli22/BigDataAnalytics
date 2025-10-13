// const fs = require("fs");
// const axios = require("axios");
// const FormData = require("form-data");
// const path = require("path");

// const URL = "http://localhost:8080/";
// const files = ["A.java", "B.java"]; // the test files

// async function sendFile(filename) {
//   const form = new FormData();
//   const data = fs.readFileSync(path.join(__dirname, filename), "utf-8");
//   form.append("data", data, { filename });
//   form.append("name", filename);

//   try {
//     await axios.post(URL, form, {
//       headers: form.getHeaders(),
//     });
//     console.log(`Sent: ${filename}`);
//   } catch (err) {
//     console.error(`Error sending ${filename}:`, err.message);
//   }
// }

// (async () => {
//   for (let i = 0; i < 50; i++) { // send each file 50 times
//     for (let file of files) {
//       await sendFile(file);
//     }
//   }
// })();
