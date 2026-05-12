import 'dart:typed_data';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import '../../presentation/providers/chat_messages_provider.dart';

// ─── Design tokens (PDF colour space: 0.0 – 1.0) ────────────────────────────

const _sage      = PdfColor(0.239, 0.600, 0.439);   // #3D9970
const _sageLight = PdfColor(0.929, 0.969, 0.953);   // #EDF7F3
const _ink       = PdfColor(0.067, 0.094, 0.153);   // #111827
const _muted     = PdfColor(0.420, 0.447, 0.502);   // #6B7280
const _border    = PdfColor(0.898, 0.910, 0.922);   // #E5E7EB
const _aiBg      = PdfColor(0.941, 0.957, 0.973);   // #F0F4F8

// ═══════════════════════════════════════════════════════════════════════════════
// ChatPdfService
//
// Pure-Dart PDF builder — no Flutter widgets.
// Call [generate] to get raw bytes, then hand them to Printing.sharePdf().
// ═══════════════════════════════════════════════════════════════════════════════

class ChatPdfService {
  ChatPdfService._();

  /// Renders [session] to a PDF and returns the raw bytes.
  static Future<Uint8List> generate(ChatSession session) async {
    final bold    = pw.Font.helveticaBold();
    final regular = pw.Font.helvetica();
    final oblique = pw.Font.helveticaOblique();
    final dateStr = _formatDate(session.date);

    final pdf = pw.Document(
      title:   'Amina Care – ${session.title}',
      author:  'Amina Care',
      subject: 'Health Chat Transcript',
    );

    pdf.addPage(
      pw.MultiPage(
        pageFormat:  PdfPageFormat.a4,
        margin:      const pw.EdgeInsets.symmetric(
            horizontal: 44, vertical: 40),
        header:      (_) => _pageHeader(
            session.title, dateStr, bold, regular),
        footer:      (ctx) => _pageFooter(
            ctx, dateStr, regular, oblique),
        build:       (_) => [
          pw.SizedBox(height: 18),
          pw.Text(
            'Conversation Transcript',
            style: pw.TextStyle(
              font:      bold,
              fontSize:  9,
              color:     _muted,
              letterSpacing: 0.8,
            ),
          ),
          pw.SizedBox(height: 14),
          ...session.messages.map(
            (m) => _messageTile(m, bold, regular)),
        ],
      ),
    );

    return pdf.save();
  }

  // ── Date formatting ───────────────────────────────────────────────────────────

  static const _months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  static String _formatDate(DateTime dt) =>
      '${_months[dt.month - 1]} ${dt.day}, ${dt.year}';

  // ── Per-page header ───────────────────────────────────────────────────────────
  //
  // Rendered at the top of every page:
  //   • Sage brand bar (AMINA CARE + subtitle on left, date on right)
  //   • Session title below bar
  //   • Hairline divider

  static pw.Widget _pageHeader(
    String title,
    String dateStr,
    pw.Font bold,
    pw.Font regular,
  ) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        // ── Brand bar ────────────────────────────────────────────────────────
        pw.Container(
          width:   double.infinity,
          padding: const pw.EdgeInsets.symmetric(
              horizontal: 18, vertical: 13),
          decoration: const pw.BoxDecoration(
            color: _sage,
            borderRadius: pw.BorderRadius.all(pw.Radius.circular(10)),
          ),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            crossAxisAlignment: pw.CrossAxisAlignment.center,
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'AMINA CARE',
                    style: pw.TextStyle(
                      font:          bold,
                      fontSize:      13,
                      color:         PdfColors.white,
                      letterSpacing: 2.0,
                    ),
                  ),
                  pw.SizedBox(height: 2),
                  pw.Text(
                    'Health Chat Transcript',
                    style: pw.TextStyle(
                      font:      regular,
                      fontSize:  8.5,
                      color:     PdfColors.white,
                    ),
                  ),
                ],
              ),
              pw.Text(
                dateStr,
                style: pw.TextStyle(
                  font:      regular,
                  fontSize:  8.5,
                  color:     PdfColors.white,
                ),
              ),
            ],
          ),
        ),

        pw.SizedBox(height: 10),

        // ── Session title ────────────────────────────────────────────────────
        pw.Text(
          title,
          style: pw.TextStyle(
            font:      bold,
            fontSize:  12,
            color:     _ink,
          ),
        ),

        pw.SizedBox(height: 8),
        pw.Divider(color: _border, thickness: 0.5),
      ],
    );
  }

  // ── Per-page footer ───────────────────────────────────────────────────────────

  static pw.Widget _pageFooter(
    pw.Context ctx,
    String dateStr,
    pw.Font regular,
    pw.Font oblique,
  ) {
    return pw.Column(
      children: [
        pw.Divider(color: _border, thickness: 0.5),
        pw.SizedBox(height: 4),
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text(
              'Generated by Amina Care  ·  $dateStr',
              style: pw.TextStyle(
                  font: oblique, fontSize: 7.5, color: _muted),
            ),
            pw.Text(
              'Page ${ctx.pageNumber} of ${ctx.pagesCount}',
              style: pw.TextStyle(
                  font: regular, fontSize: 7.5, color: _muted),
            ),
          ],
        ),
      ],
    );
  }

  // ── Message tile ──────────────────────────────────────────────────────────────
  //
  // User messages: indented from the left (appears right-heavy).
  // AI messages:   indented from the right (appears left-heavy).
  // Side avatar circle labels the sender at a glance.

  static pw.Widget _messageTile(
    ChatMessage msg,
    pw.Font bold,
    pw.Font regular,
  ) {
    final isUser = msg.isUser;

    return pw.Padding(
      padding: pw.EdgeInsets.only(
        left:   isUser ? 70 : 0,
        right:  isUser ? 0  : 70,
        bottom: 10,
      ),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          // ── AI avatar ─────────────────────────────────────────────────────
          if (!isUser) ...[
            _avatarCircle('A', bold,
                bg:   _sage,
                text: PdfColors.white),
            pw.SizedBox(width: 8),
          ],

          // ── Bubble ────────────────────────────────────────────────────────
          pw.Expanded(
            child: pw.Container(
              padding: const pw.EdgeInsets.symmetric(
                  horizontal: 14, vertical: 10),
              decoration: pw.BoxDecoration(
                color: isUser ? _sage : _aiBg,
                borderRadius: const pw.BorderRadius.all(
                    pw.Radius.circular(12)),
              ),
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  // Sender + time row
                  pw.Row(
                    mainAxisAlignment:
                        pw.MainAxisAlignment.spaceBetween,
                    children: [
                      pw.Text(
                        isUser ? 'You' : 'Amina',
                        style: pw.TextStyle(
                          font:      bold,
                          fontSize:  8,
                          color: isUser
                              ? PdfColors.white
                              : _sage,
                        ),
                      ),
                      pw.Text(
                        msg.time,
                        style: pw.TextStyle(
                          font:      regular,
                          fontSize:  7,
                          color: isUser
                              ? PdfColors.white
                              : _muted,
                        ),
                      ),
                    ],
                  ),
                  pw.SizedBox(height: 5),
                  // Message content
                  pw.Text(
                    msg.text,
                    style: pw.TextStyle(
                      font:         regular,
                      fontSize:     9.5,
                      lineSpacing:  2,
                      color: isUser ? PdfColors.white : _ink,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // ── User avatar ───────────────────────────────────────────────────
          if (isUser) ...[
            pw.SizedBox(width: 8),
            _avatarCircle('U', bold,
                bg:     _sageLight,
                text:   _sage,
                border: _sage),
          ],
        ],
      ),
    );
  }

  // ── Sender avatar circle ─────────────────────────────────────────────────────

  static pw.Widget _avatarCircle(
    String letter,
    pw.Font bold, {
    required PdfColor bg,
    required PdfColor text,
    PdfColor? border,
  }) {
    return pw.Container(
      width:  20,
      height: 20,
      decoration: pw.BoxDecoration(
        color:  bg,
        shape:  pw.BoxShape.circle,
        border: border != null
            ? pw.Border.all(color: border, width: 0.8)
            : null,
      ),
      child: pw.Center(
        child: pw.Text(
          letter,
          style: pw.TextStyle(
            font:      bold,
            fontSize:  9,
            color:     text,
          ),
        ),
      ),
    );
  }
}
