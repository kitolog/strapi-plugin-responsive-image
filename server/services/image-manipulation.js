"use strict";
/**
 * Image manipulation functions
 */
const fs = require("fs");
const { join } = require("path");
const sharp = require("sharp");
const mime = require("mime-types");

const {
  file: { bytesToKbytes },
} = require("@strapi/utils");
const { getService } = require("../utils");
const pluginUpload = require("@strapi/plugin-upload/strapi-server");
const imageManipulation = pluginUpload().services["image-manipulation"];

const writeStreamToFile = (stream, path) =>
  new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(path);
    // Reject promise if there is an error with the provided stream
    stream.on("error", reject);
    stream.pipe(writeStream);
    writeStream.on("close", resolve);
    writeStream.on("error", reject);
  });

const getMetadata = (file) =>
  new Promise((resolve, reject) => {
    const pipeline = sharp();
    pipeline.metadata().then(resolve).catch(reject);
    file.getStream().pipe(pipeline);
  });

const resizeFileTo = async (
  file,
  options,
  quality,
  progressive,
  autoOrientation,
  watermark,
  { name, hash, ext, format }
) => {
  const filePath = join(file.tmpWorkingDirectory, hash);

  let sharpInstance = autoOrientation ? sharp().rotate() : sharp();

  if (options.convertToFormat) {
    sharpInstance = sharpInstance.toFormat(options.convertToFormat);
  }

  sharpInstance.resize(options);

  if(watermark){
    const color = RGBAToHexA(watermark.color)
    const watermarkImage = await sharp({
      text: {
        text: `<span foreground="${color}">${watermark.text}</span>`,
        rgba: true,
        font: 'Arial',
        dpi: 250,
      },
    }).extend({
      top: 20,
      bottom: 20,
      left: 20,
      right: 20,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).png().toBuffer();

    sharpInstance = sharpInstance.composite([{
      input: watermarkImage,
      gravity: watermark.position,
      tile: false,
    }])
  }


  switch (format) {
    case "jpg":
      sharpInstance.jpeg({ quality, progressive, force: false });
      break;
    case "png":
      sharpInstance.png({
        compressionLevel: Math.floor((quality / 100) * 9),
        progressive,
        force: false,
      });
      break;
    case "webp":
      sharpInstance.webp({ quality, force: false });
      break;
    case "avif":
      sharpInstance.avif({ quality });
      break;

    default:
      break;
  }

  await writeStreamToFile(file.getStream().pipe(sharpInstance), filePath);
  const newFile = {
    name,
    hash,
    ext,
    mime: options.convertToFormat ? mime.lookup(ext) : file.mime,
    path: file.path || null,
    getStream: () => fs.createReadStream(filePath),
  };

  const { width, height, size } = await getMetadata(newFile);

  Object.assign(newFile, { width, height, size: bytesToKbytes(size) });
  return newFile;
};

const generateResponsiveFormats = async (file) => {
  const { responsiveDimensions = false, autoOrientation = false } = await strapi
    .plugin("upload")
    .service("upload")
    .getSettings();

  if (!responsiveDimensions) return [];

  // if (!(await isImage(file))) {
  //   return [];
  // }

  const { formats, quality, progressive, watermarkText, watermarkPosition, watermarkColor } = await getService(
    "responsive-image"
  ).getSettings();


  const watermark = watermarkText ? {
    text: watermarkText,
    position: watermarkPosition,
    color: watermarkColor || 'rgba(255,255,255,0.5)',
  } : null

  const x2Formats = [];
  const x1Formats = formats.map((format) => {
    if (format.x2) {
      x2Formats.push(
        generateBreakpoint(`${format.name}_x2`, {
          file,
          format: {
            ...format,
            width: format.width * 2,
            height: format.height ? format.height * 2 : null,
          },
          quality,
          progressive,
          autoOrientation,
          watermark
        })
      );
    }
    return generateBreakpoint(format.name, {
      file,
      format,
      quality,
      progressive,
      autoOrientation,
      watermark
    });
  });

  return Promise.all([...x1Formats, ...x2Formats]);
};

const getFileExtension = (file, { convertToFormat }) => {
  if (!convertToFormat) {
    return file.ext;
  }

  return `.${convertToFormat}`;
};

const generateBreakpoint = async (
  key,
  { file, format, quality, progressive, autoOrientation, watermark },
) => {
  const newFile = await resizeFileTo(
    file,
    format,
    quality,
    progressive,
    autoOrientation,
    watermark,
    {
      name: `${key}_${file.name}`,
      hash: `${key}_${file.hash}`,
      ext: getFileExtension(file, format),
      format,
    }
  );
  return {
    key,
    file: newFile,
  };
};

function RGBAToHexA(rgba, forceRemoveAlpha = false) {
  return "#" + rgba.replace(/^rgba?\(|\s+|\)$/g, '') // Get's rgba / rgb string values
    .split(',') // splits them at ","
    .filter((string, index) => !forceRemoveAlpha || index !== 3)
    .map(string => parseFloat(string)) // Converts them to numbers
    .map((number, index) => index === 3 ? Math.round(number * 255) : number) // Converts alpha to 255 number
    .map(number => number.toString(16)) // Converts numbers to hex
    .map(string => string.length === 1 ? "0" + string : string) // Adds 0 when length of one number is 1
    .join("") // Puts the array to togehter to a string
}

module.exports = () => ({
  ...imageManipulation(),
  generateResponsiveFormats,
});
