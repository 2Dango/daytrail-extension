const landscape = document.querySelector('#landscape');
landscape.width = 480;
landscape.height = 110;
const pen = landscape.getContext('2d');
pen.fillStyle = '#d7eced';
pen.fillRect(0, 0, 480, 110);
function box(x, y, w, h, color) {
  pen.fillStyle = color;
  pen.fillRect(x, y, w, h);
}
box(380, 13, 25, 25, '#f5c96b');
for (const [x, y] of [[23,19],[140,11],[280,26]]) {
  box(x,y,32,7,'#fff9e8'); box(x+6,y-5,17,5,'#fff9e8');
}
for(let x=0;x<480;x+=8) {
  const h = 24 + Math.round(14*Math.sin(x/50)+10*Math.cos(x/27));
  box(x,110-h,8,h,'#a7c5aa');
  const near = 15 + Math.round(9*Math.sin(x/35+2));
  box(x,110-near,8,near,'#568369');
}
for(const x of [12,42,64,395,430,458]) {
  const y=60+(x%11);
  box(x+7,y+19,4,24,'#5b5743');
  box(x+3,y,12,8,'#38694e');
  box(x,y+8,18,9,'#38694e');
  box(x-4,y+17,26,10,'#38694e');
  box(x+3,y+9,4,10,'#7da66b');
}
for(let y=85;y<110;y+=5)box(230-(y-85),y,16+(y-85)*2,5,'#e9d5a4');

const letters = {
 D:['11110','10001','10001','10001','10001','10001','11110'],
 A:['01110','10001','10001','11111','10001','10001','10001'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],
 T:['11111','00100','00100','00100','00100','00100','00100'],
 R:['11110','10001','10001','11110','10100','10010','10001'],
 I:['111','010','010','010','010','010','111'],
 L:['10000','10000','10000','10000','10000','10000','11111'],
};
const title=document.querySelector('#wordmark');
title.width=170; title.height=35;
const ink=title.getContext('2d');
for(const [offset,color] of [[3,'#1d4538'],[1,'#fff7dc'],[0,'#fff7dc']]) {
  let x=4;
  for(const letter of 'DAYTRAIL') {
    const glyph=letters[letter];
    glyph.forEach((row,y)=>Array.from(row).forEach((pixel,c)=>{
      if(pixel==='1'){ink.fillStyle=color;ink.fillRect(x+c*3+offset,4+y*3+offset,3,3);}
    }));
    x+=(glyph[0].length+1)*3;
  }
}
