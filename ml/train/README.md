# 屋顶障碍物 U-Net：AutoDL 训练说明

用航拍图（15 cm/像素）预测屋顶上的设备、楼梯间、检修口等障碍物。标签由 2017 年纽约 LiDAR 自动生成：屋面上凸起 0.45 m 以上、宽度小于 8 m 的东西算障碍物。坡屋顶、屋顶边缘和不同高度屋面的交界处不参与训练（掩膜值 0）。

## 包里有什么

```
autodl-package/
  dataset/
    images/{切片}_{年份}.jpg   512×512，2014/2016/2018 三个年份
    masks/{切片}.png           0 = 忽略，1 = 屋面，2 = 障碍物
    splits.json                训练/验证/测试划分（按 LiDAR 块划分，互不相邻）
    meta.json                  生成参数
  train/
    common.py  train.py  evaluate.py  export_onnx.py  requirements.txt  README.md
```

## 在 AutoDL 上运行

推荐镜像：PyTorch 2.x + CUDA 12.x，任意 24 GB 显卡（RTX 3090/4090 即可；12 GB 也够，把 batch 改成 8）。60 轮约 7 分钟。

安装依赖时要关掉学术加速（开着会连不上 pip 镜像），训练时再打开（下载 ImageNet 预训练权重需要）。用 `nohup` 放到后台运行，关掉网页也不会中断：

```bash
cd /root/autodl-tmp && unzip -q autodl-package.zip
cd autodl-package/train && unset http_proxy https_proxy && pip install -r requirements.txt
source /etc/network_turbo && nohup python train.py --data ../dataset --out runs/unet > train.log 2>&1 &
tail -f train.log        # Ctrl+C 只退出查看，训练继续；断了加 --resume 接着训

# 训练结束（出现 best val f1）后依次运行，期间不要按键
python evaluate.py --data ../dataset --run runs/unet
python export_onnx.py --run runs/unet
cd runs && zip -r unet-result.zip unet -x "unet/*.pt"
```

预训练权重下载不了时，加 `--no-pretrained` 从零训练（效果会差一些，可以把 `--epochs` 加到 100）。

想试更大的编码器：`--encoder efficientnet-b0`（模型约大一倍）。

## 训练完下载这些文件

```
runs/unet/model.fp16.onnx   约 8 MB，浏览器用这个
runs/unet/model.onnx        fp32 版本，备用
runs/unet/model.json        输入格式、阈值、测试成绩
runs/unet/metrics.json      验证集阈值扫描和测试集成绩
runs/unet/log.csv           每轮损失和验证成绩
runs/unet/previews/         测试集对比图：红色 = LiDAR 障碍物，青色轮廓 = 模型预测，变暗 = 未标注
```

`best.pt` 和 `last.pt` 可以留在服务器上，以后想接着训再用。

## 看成绩

- `f1` / `iou`：像素级，对比 LiDAR 标签。障碍物形状不规则，像素 IoU 0.4–0.5 就算不错。
- `object_recall`：LiDAR 标出的障碍物里，被模型碰到的比例（漏检越少越高）。
- `object_precision`：模型标出的区块里，确实有障碍物的比例（误报越少越高）。

禁装区只需要把东西框住，所以主要看两个 object 指标。

标签本身有噪声（LiDAR 是 2017 年，航拍是 2014/2016/2018 年；平贴在屋面上的天窗没有高度差，标不出来），所以成绩不会接近 1。
