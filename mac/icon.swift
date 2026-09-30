// Plumb's app icon: one white plumb bob on a dark macOS rounded square.
// One idea only — the string and its weight, nothing else.
//
//   swift mac/icon.swift out.png        (mac/build-app.sh runs this)
//
// Geometry follows Apple's macOS icon grid: an 824 px rounded square with a
// ~185 px corner radius, centred on the 1024 canvas, transparent outside it.
// It prints the glyph's measured box — measure, never eyeball.

import CoreGraphics
import Foundation
import ImageIO

let size = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("could not make a bitmap context")
}
// Draw in top-left coordinates, y growing down, like a design file.
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

let white = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)

// MARK: tile — #1B1B1B at the top to #0F0F10 at the bottom

let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let corner: CGFloat = 185
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: tile, cornerWidth: corner, cornerHeight: corner, transform: nil))
ctx.clip()
let fill = CGGradient(colorsSpace: sRGB,
                      colors: [CGColor(srgbRed: 0x1B / 255, green: 0x1B / 255, blue: 0x1B / 255, alpha: 1),
                               CGColor(srgbRed: 0x0F / 255, green: 0x0F / 255, blue: 0x10 / 255, alpha: 1)] as CFArray,
                      locations: [0, 1])!
ctx.drawLinearGradient(fill, start: CGPoint(x: 0, y: tile.minY), end: CGPoint(x: 0, y: tile.maxY), options: [])
ctx.restoreGState()

// A 1 px lighter edge just inside the tile, so a dark icon keeps its shape on a dark Dock.
ctx.addPath(CGPath(roundedRect: tile.insetBy(dx: 0.5, dy: 0.5),
                   cornerWidth: corner - 0.5, cornerHeight: corner - 0.5, transform: nil))
ctx.setStrokeColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.12))
ctx.setLineWidth(1)
ctx.strokePath()

// MARK: the plumb bob — string, collar, and a teardrop pointing down

let cx = tile.midX
let glyphHeight = (tile.height * 0.55).rounded()          // 55% of the tile
let glyphTop = (tile.midY - glyphHeight / 2).rounded()    // centred on the tile
let tipY = glyphTop + glyphHeight

// Bob: the top of a circle, with straight sides tangent to it that meet in the point.
// Radius 84 leaves the line about a third of the glyph; at 98 the line was a
// stub and the whole thing read as a map pin.
let bobRadius: CGFloat = 84
let centreToTip: CGFloat = 2.3 * bobRadius
let bobCentreY = tipY - centreToTip
let halfAngle = acos(bobRadius / centreToTip)             // tangent point, from straight down
let bob = CGMutablePath()
bob.move(to: CGPoint(x: cx, y: tipY))
let from = CGFloat.pi / 2 - halfAngle                     // right tangent point (y grows down)
let sweep = 2 * CGFloat.pi - 2 * halfAngle                // up and over the top to the left one
let steps = 720
for i in 0...steps {
    let a = from - sweep * CGFloat(i) / CGFloat(steps)
    bob.addLine(to: CGPoint(x: cx + bobRadius * cos(a), y: bobCentreY + bobRadius * sin(a)))
}
bob.closeSubpath()
ctx.addPath(bob)
ctx.setFillColor(white)
ctx.fillPath()

// Collar where the string ties on, sunk a little into the top of the bob.
let collar = CGRect(x: cx - 30, y: bobCentreY - bobRadius - 30, width: 60, height: 42)
ctx.addPath(CGPath(roundedRect: collar, cornerWidth: 10, cornerHeight: 10, transform: nil))
ctx.fillPath()

// String: from the top of the glyph down into the collar. The round cap sits
// inside the glyph box, so its top edge is exactly glyphTop.
let stringWidth: CGFloat = 16
ctx.setStrokeColor(white)
ctx.setLineWidth(stringWidth)
ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: cx, y: glyphTop + stringWidth / 2))
ctx.addLine(to: CGPoint(x: cx, y: collar.minY + 8))
ctx.strokePath()

// MARK: measure, then write

guard let pixels = ctx.data?.assumingMemoryBound(to: UInt8.self) else { fatalError("no pixels") }
var minX = size, maxX = -1, minY = size, maxY = -1
for y in 0..<size {
    for x in 0..<size {
        let p = y * ctx.bytesPerRow + x * 4
        if pixels[p + 3] > 128 && pixels[p] > 128 {       // the white glyph, not the dark tile
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
        }
    }
}
let w = maxX - minX + 1, h = maxY - minY + 1
let t = (x: Int(tile.minX), y: Int(tile.minY), maxX: Int(tile.maxX), maxY: Int(tile.maxY))
print("glyph \(w)×\(h)px = \(String(format: "%.1f", Double(h) / Double(tile.height) * 100))% of the tile's height")
print("inside the tile: left \(minX - t.x) right \(t.maxX - 1 - maxX) top \(minY - t.y) bottom \(t.maxY - 1 - maxY)")

guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)
else { fatalError("could not write \(out)") }
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(out)") }
print("wrote \(out)")
