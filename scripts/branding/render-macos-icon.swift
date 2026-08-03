#!/usr/bin/env swift
import AppKit
import Foundation

// Renders Exva macOS app icons at exact pixel sizes (no Retina doubling):
// - icon.png: full-bleed opaque square (packager / .icns — system applies mask)
// - icon-dock.png: pre-masked squircle with alpha (app.dock.setIcon during forge start)
// - src/assets/exva-icon.png + public/favicon.png: UI / favicon marks

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : FileManager.default.currentDirectoryPath)

let teal = NSColor(srgbRed: 0.176, green: 0.831, blue: 0.749, alpha: 1) // #2DD4BF
let slate = NSColor(srgbRed: 0.45, green: 0.52, blue: 0.58, alpha: 1)
let top = NSColor(srgbRed: 0.14, green: 0.18, blue: 0.24, alpha: 1)
let bottom = NSColor(srgbRed: 0.05, green: 0.07, blue: 0.10, alpha: 1)

/// Bitmap coords via lockFocusFlipped: origin top-left, y down.
func drawGlyph(in rect: CGRect, context: CGContext) {
  let cx = rect.midX
  let cy = rect.midY - rect.height * 0.06

  let arm = rect.width * 0.30
  let thickness = rect.width * 0.09
  context.saveGState()
  context.setStrokeColor(teal.cgColor)
  context.setLineWidth(thickness)
  context.setLineCap(.round)
  context.setLineJoin(.round)
  context.move(to: CGPoint(x: cx - arm, y: cy - arm * 0.95))
  context.addLine(to: CGPoint(x: cx + arm, y: cy + arm * 0.95))
  context.move(to: CGPoint(x: cx + arm, y: cy - arm * 0.95))
  context.addLine(to: CGPoint(x: cx - arm, y: cy + arm * 0.95))
  context.strokePath()
  context.restoreGState()

  let bodyH: [CGFloat] = [0.11, 0.18, 0.12]
  let colors = [slate, teal, slate]
  let spacing = rect.width * 0.12
  let bodyW = rect.width * 0.048
  let startX = cx - spacing
  let topOfCandles = rect.maxY - rect.height * 0.28
  for i in 0..<3 {
    let x = startX + CGFloat(i) * spacing
    let h = rect.height * bodyH[i]
    let body = CGRect(x: x - bodyW / 2, y: topOfCandles, width: bodyW, height: h)
    context.setFillColor(colors[i].cgColor)
    context.fill(body)
    context.setStrokeColor(colors[i].cgColor)
    context.setLineWidth(max(2, rect.width * 0.008))
    context.setLineCap(.round)
    context.move(to: CGPoint(x: x, y: topOfCandles - rect.height * 0.035))
    context.addLine(to: CGPoint(x: x, y: topOfCandles + h + rect.height * 0.04))
    context.strokePath()
  }
}

func fillBackground(in rect: CGRect, context: CGContext, clipped: Bool) {
  let radius = rect.width * 0.2237
  let path = CGPath(
    roundedRect: rect,
    cornerWidth: clipped ? radius : 0,
    cornerHeight: clipped ? radius : 0,
    transform: nil,
  )

  if clipped {
    context.addPath(path)
    context.clip()
  } else {
    context.setFillColor(bottom.cgColor)
    context.fill(rect)
  }

  let colors = [top.cgColor, bottom.cgColor] as CFArray
  let space = CGColorSpaceCreateDeviceRGB()
  if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
    context.drawLinearGradient(
      gradient,
      start: CGPoint(x: rect.midX, y: rect.minY),
      end: CGPoint(x: rect.midX, y: rect.maxY),
      options: [],
    )
  }

  let highlight = [
    NSColor.white.withAlphaComponent(0.12).cgColor,
    NSColor.white.withAlphaComponent(0).cgColor,
  ] as CFArray
  if let g = CGGradient(colorsSpace: space, colors: highlight, locations: [0, 1]) {
    context.drawLinearGradient(
      g,
      start: CGPoint(x: rect.midX, y: rect.minY),
      end: CGPoint(x: rect.midX, y: rect.midY),
      options: [],
    )
  }

  if clipped {
    context.addPath(path)
    context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
    context.setLineWidth(max(1, rect.width * 0.004))
    context.strokePath()
  }
}

func makeRep(pixels: Int, dockMasked: Bool) -> NSBitmapImageRep {
  let size = CGFloat(pixels)
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0,
  )!
  rep.size = NSSize(width: size, height: size)

  NSGraphicsContext.saveGraphicsState()
  let gc = NSGraphicsContext(bitmapImageRep: rep)!
  gc.imageInterpolation = .high
  NSGraphicsContext.current = gc
  let context = gc.cgContext

  context.setFillColor(NSColor.clear.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: size, height: size))
  // Flip to top-left origin for easier layout math
  context.translateBy(x: 0, y: size)
  context.scaleBy(x: 1, y: -1)

  if dockMasked {
    let margin = size * 0.08
    let tile = CGRect(x: margin, y: margin, width: size - margin * 2, height: size - margin * 2)

    context.saveGState()
    context.setShadow(
      offset: CGSize(width: 0, height: size * 0.012),
      blur: size * 0.05,
      color: NSColor.black.withAlphaComponent(0.40).cgColor,
    )
    let radius = tile.width * 0.2237
    let shadowPath = CGPath(
      roundedRect: tile,
      cornerWidth: radius,
      cornerHeight: radius,
      transform: nil,
    )
    context.addPath(shadowPath)
    context.setFillColor(NSColor.black.cgColor)
    context.fillPath()
    context.restoreGState()

    context.saveGState()
    fillBackground(in: tile, context: context, clipped: true)
    let contentInset = tile.width * 0.18
    drawGlyph(in: tile.insetBy(dx: contentInset, dy: contentInset), context: context)
    context.restoreGState()
  } else {
    let tile = CGRect(x: 0, y: 0, width: size, height: size)
    fillBackground(in: tile, context: context, clipped: false)
    let contentInset = size * 0.20
    drawGlyph(in: tile.insetBy(dx: contentInset, dy: contentInset), context: context)
  }

  NSGraphicsContext.restoreGraphicsState()
  return rep
}

func writePNG(_ rep: NSBitmapImageRep, to url: URL) throws {
  guard let data = rep.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "exva.icon", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Failed to encode PNG for \(url.path)",
    ])
  }
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true,
  )
  try data.write(to: url)
}

let assets = root.appendingPathComponent("assets")
let srcAssets = root.appendingPathComponent("src/assets")
let publicDir = root.appendingPathComponent("public")

try writePNG(makeRep(pixels: 1024, dockMasked: false), to: assets.appendingPathComponent("icon.png"))
try writePNG(makeRep(pixels: 1024, dockMasked: true), to: assets.appendingPathComponent("icon-dock.png"))
try writePNG(makeRep(pixels: 256, dockMasked: true), to: srcAssets.appendingPathComponent("exva-icon.png"))
try writePNG(makeRep(pixels: 64, dockMasked: true), to: publicDir.appendingPathComponent("favicon.png"))

print("wrote icon.png, icon-dock.png, exva-icon.png, favicon.png")
