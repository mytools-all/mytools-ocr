import {
  $,
  $$,
  action,
  copy,
  status,
  ready,
  call,
  download,
} from "./common.mjs";
import md5 from "./md5.mjs";
let image = "",
  fileName = "",
  rawText = "",
  history = [],
  busy = false;
function tab(id) {
  for (const section of ["recognize", "settings", "history"])
    $("#" + section).classList.toggle("hidden", section !== id);
  for (const name of ["recognize", "settings", "history"])
    $("#" + name + "-tab").classList.toggle("active", name === id);
  if (id === "history") renderHistory();
}
for (const name of ["recognize", "settings", "history"])
  $("#" + name + "-tab").onclick = () => tab(name);
function settings() {
  return {
    appid: $("#appid").value.trim(),
    key: $("#key").value.trim(),
    mode: $("#mode").value,
  };
}
function populate(c) {
  $("#appid").value = c.appid || "";
  $("#key").value = c.key || "";
  $("#mode").value = c.mode || "print";
}
async function loadFile(file) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/bmp"].includes(file.type))
    throw Error("仅支持 JPG / PNG / BMP 图片");
  if (file.size > 3 * 1024 * 1024) throw Error("图片不能超过 3 MB");
  image = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("图片读取失败"));
    r.readAsDataURL(file);
  });
  fileName = file.name || "粘贴的图片";
  $("#image").src = image;
  $("#image").hidden = false;
  tab("recognize");
  status(fileName + " · " + Math.round(file.size / 1024) + " KB");
}
$("#choose").onclick = () => $("#file").click();
$("#file").onchange = action(() => loadFile($("#file").files[0]));
$("#drop").ondragover = (e) => {
  e.preventDefault();
  $("#drop").classList.add("over");
};
$("#drop").ondragleave = () => $("#drop").classList.remove("over");
$("#drop").ondrop = action(async (e) => {
  e.preventDefault();
  $("#drop").classList.remove("over");
  await loadFile(e.dataTransfer.files[0]);
});
document.addEventListener(
  "paste",
  action(async (e) => {
    const item = [...e.clipboardData.items].find((i) =>
      i.type.startsWith("image/"),
    );
    if (item) {
      e.preventDefault();
      await loadFile(item.getAsFile());
    }
  }),
);
$("#save").onclick = action(async () => {
  const c = settings();
  if (!c.appid || !c.key) throw Error("请填写 App ID 和 API Key");
  if ($("#remember").checked)
    await call("storage.set", { key: "credentials", value: c });
  else await call("storage.del", { key: "credentials" });
  status($("#remember").checked ? "设置已保存在本机" : "设置仅保留到关闭插件");
  tab("recognize");
});
$("#forget").onclick = action(async () => {
  await call("storage.del", { key: "credentials" });
  populate({});
  $("#remember").checked = false;
  status("已清除本机保存的凭据");
});
function resultText(response) {
  const blocks = response.data?.block || [];
  return blocks
    .flatMap((b) =>
      (b.line || []).map((l) =>
        (l.word || []).map((w) => w.content || "").join(""),
      ),
    )
    .join("\n");
}
$("#run").onclick = action(async () => {
  const c = settings();
  if (!c.appid || !c.key) {
    tab("settings");
    throw Error("请先配置自己的讯飞 OCR WebAPI 凭据");
  }
  if (!image) throw Error("请先选择或粘贴图片");
  if (busy) return;
  busy = true;
  $("#run").disabled = true;
  try {
    status("正在识别…");
    const time = String(Math.floor(Date.now() / 1000));
    const param = btoa(
      JSON.stringify({ language: "cn|en", location: "false" }),
    );
    const response = await call("net.fetch", {
      url:
        "https://webapi.xfyun.cn/v1/service/v1/ocr/" +
        (c.mode === "handwrite" ? "handwriting" : "general"),
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "X-Appid": c.appid,
        "X-CurTime": time,
        "X-Param": param,
        "X-CheckSum": md5(c.key + time + param),
      },
      body: "image=" + encodeURIComponent(image.split(",")[1]),
    });
    if (response.status !== 200)
      throw Error("讯飞服务返回 HTTP " + response.status);
    let result;
    try {
      result = JSON.parse(response.body);
    } catch {
      throw Error("讯飞响应不是有效 JSON");
    }
    if (String(result.code) !== "0")
      throw Error(
        "识别失败（" +
          result.code +
          "）：" +
          (result.desc || result.message || "请检查接口权限与凭据"),
      );
    rawText = resultText(result);
    if (!rawText) throw Error("未识别到文字，请检查图片清晰度");
    $("#result").value = $("#merge").checked
      ? rawText.replace(/\n/g, "")
      : rawText;
    history = [
      { name: fileName, time: Date.now(), text: rawText },
      ...history,
    ].slice(0, 30);
    status("识别完成 · " + rawText.length + " 字符");
  } finally {
    busy = false;
    $("#run").disabled = false;
  }
});
$("#merge").onchange = () => {
  $("#result").value = $("#merge").checked
    ? $("#result").value.replace(/\n/g, "")
    : rawText;
};
$("#copy").onclick = action(() => copy($("#result").value));
$("#export").onclick = () => download("识别结果.txt", $("#result").value);
function renderHistory() {
  $("#history").replaceChildren();
  if (!history.length) {
    $("#history").textContent = "本次会话还没有识别记录；关闭插件后清除。";
    return;
  }
  for (const entry of history) {
    const b = document.createElement("button");
    b.style.cssText =
      "display:block;width:100%;text-align:left;margin-bottom:8px;white-space:normal";
    b.textContent =
      entry.name +
      " · " +
      new Date(entry.time).toLocaleString() +
      "\n" +
      entry.text.slice(0, 100);
    b.onclick = () => {
      rawText = entry.text;
      $("#result").value = entry.text;
      tab("recognize");
    };
    $("#history").append(b);
  }
}
ready(async () => {
  const c = await call("storage.get", { key: "credentials" });
  if (c) {
    populate(c);
    $("#remember").checked = true;
  }
  status("请选择图片 · 需要自行开通讯飞印刷 / 手写文字识别 WebAPI");
});
