/**
 * Demo mode — activated with ?demo=1 (see app.ts).
 *
 * Real login is currently disabled (LOGIN_DISABLED in login-view.ts, plus
 * the backend switch in services/identity-svc/api/otp-request.ts). This
 * exists so the app's screens can still be previewed: DemoAuth substitutes
 * for Auth everywhere, and its authedFetch() answers the read endpoints and
 * sync/push locally with the sample data below — no request ever leaves the
 * device, and nothing here can touch real tenant data.
 */
import { Auth } from './auth.ts';
import type { PushRequest, PushResponse } from '../../../packages/offline/src/types.ts';
import type { SectionSummary, RosterStudent } from './roster-view.ts';
import type { RoutineSlot } from './routine-view.ts';
import { parseBranding } from '../../../packages/ui-core/src/branding.ts';
import { formatCount, todayLocalIso } from '../../../packages/ui-core/src/format.ts';
import { brandedDocumentSet, type BrandedSection } from '../../../packages/ui-core/src/branded-doc.ts';
import {
  parseNotice, NoticeError, smsSegmentsFor, type NoticeDraft,
} from '../../../packages/ui-core/src/notice.ts';
import {
  documentBodyCss, buildFeeReceipt, buildReportCard, buildAdmitCard, buildIdCard,
  buildTransferCertificate, buildAttendanceSheet, ADMIT_INSTRUCTIONS_BN,
  buildRoutineSheet, routineOrientation, routineSheetCss,
  type StudentRef, type RoutineScope,
} from '../../../packages/ui-core/src/documents.ts';

// `academicYearId` is required and was missing from all three. The rest of
// this file already answers 'demo-year' for it, so the demo was internally
// inconsistent in exactly the way R-7's real bug was: a section carrying no
// year, and attendance taken against it rejected on save. `tsc` had been
// saying so since that fix landed.
const SECTIONS: SectionSummary[] = [
  { id: 'demo-9a', name: 'ক', shift: 'morning', studentCount: 12, academicYearId: 'demo-year', className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9 },
  { id: 'demo-9b', name: 'খ', shift: 'morning', studentCount: 12, academicYearId: 'demo-year', className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9 },
  { id: 'demo-10a', name: 'ক', shift: 'day', studentCount: 12, academicYearId: 'demo-year', className: { bn: 'দশম শ্রেণি', en: 'Class 10' }, levelNo: 10 },
];

const NAMES: [string, string][] = [
  ['আরিফুল ইসলাম', 'Ariful Islam'],
  ['সুমাইয়া আক্তার', 'Sumaiya Akter'],
  ['মেহেদী হাসান', 'Mehedi Hasan'],
  ['নুসরাত জাহান', 'Nusrat Jahan'],
  ['তানভীর আহমেদ', 'Tanvir Ahmed'],
  ['ফারিয়া রহমান', 'Faria Rahman'],
  ['রাকিবুল হাসান', 'Rakibul Hasan'],
  ['সাদিয়া ইসলাম', 'Sadia Islam'],
  ['ইমরান হোসেন', 'Imran Hossain'],
  ['মিম আক্তার', 'Mim Akter'],
  ['জুবায়ের হোসেন', 'Jubayer Hossain'],
  ['তাসনিম ফেরদৌস', 'Tasnim Ferdous'],
];

function rosterFor(sectionId: string): RosterStudent[] {
  return NAMES.map(([bn, en], i) => ({
    rollNo: i + 1,
    studentId: `${sectionId}-s${i + 1}`,
    fullName: { bn, en },
    phone: null,
  }));
}

// Local fields, not UTC — see `todayLocalIso`.
const todayIso = todayLocalIso;

/**
 * The office's exam register (`?yearId=`), which is a different shape from
 * DEMO_EXAMS below — that one is the per-section marks feed.
 */
const DEMO_EXAM_REGISTER = [
  {
    id: 'demo-exam-half', nameBn: 'অর্ধ-বার্ষিক পরীক্ষা ২০২৬',
    nameEn: 'Half-Yearly Exam 2026', examType: 'half_yearly', status: 'marking',
    startsOn: '2026-06-10', endsOn: '2026-06-20',
    weightPercent: 40, isGpaBearing: true,
    paperCount: 24, sectionCount: 4, markCount: 312,
  },
  {
    id: 'demo-exam-annual', nameBn: 'বার্ষিক পরীক্ষা ২০২৬',
    nameEn: 'Annual Exam 2026', examType: 'annual', status: 'planned',
    startsOn: '2026-12-05', endsOn: '2026-12-18',
    weightPercent: 60, isGpaBearing: true,
    paperCount: 24, sectionCount: 4, markCount: 0,
  },
  {
    id: 'demo-exam-ct', nameBn: 'শ্রেণি পরীক্ষা — আগস্ট',
    nameEn: 'Class Test August', examType: 'class_test', status: 'published',
    startsOn: '2026-08-11', endsOn: '2026-08-11',
    weightPercent: 10, isGpaBearing: false,
    paperCount: 6, sectionCount: 2, markCount: 96,
  },
];

const DEMO_EXAMS = [
  {
    id: 'demo-exam-half',
    nameBn: 'অর্ধ-বার্ষিক পরীক্ষা ২০২৬',
    nameEn: 'Half-Yearly Exam 2026',
    examType: 'half_yearly',
    status: 'marking',
    academicYearId: 'demo-year',
    subjects: [
      {
        examSubjectId: 'demo-es-phy',
        subjectId: 'demo-sub-phy',
        subject: { bn: 'পদার্থবিজ্ঞান', en: 'Physics' },
        cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
        cqPass: 23, mcqPass: 10,
        markingLocked: false,
      },
      {
        examSubjectId: 'demo-es-math',
        subjectId: 'demo-sub-math',
        subject: { bn: 'গণিত', en: 'Mathematics' },
        cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
        cqPass: 23, mcqPass: 10,
        markingLocked: false,
      },
    ],
  },
];

function demoMarks() {
  return {
    academicYearId: 'demo-year',
    examStatus: 'marking',
    markingLocked: false,
    maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
    marks: NAMES.map(([bn, en], i) => ({
      rollNo: i + 1,
      studentId: `demo-s${i + 1}`,
      fullName: { bn, en },
      cqMarks: i < 6 ? 40 + i * 4 : null,
      mcqMarks: i < 6 ? 18 + i : null,
      practicalMarks: null,
      caMarks: null,
      totalMarks: i < 6 ? 58 + i * 5 : null,
      isAbsent: i === 11,
      gradeLetter: null,
      rowVersion: i < 6 ? 1 : null,
    })),
  };
}

function daySlots(date: string): RoutineSlot[] {
  // Friday/Saturday are the school weekend in Bangladesh.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 5 || weekday === 6) return [];

  const slot = (
    periodNo: number, startsAt: string, endsAt: string,
    extra: Partial<RoutineSlot> & { subjectBn: string },
  ): RoutineSlot => ({
    slotId: `${date}-p${periodNo}`,
    periodNo,
    startsAt,
    endsAt,
    slotKind: 'teaching',
    sectionLabel: null,
    roomCode: null,
    isSubstitution: false,
    coveringForBn: null,
    studentCount: 12,
    attendanceTaken: false,
    deliveryLogged: false,
    ...extra,
  });

  return [
    slot(1, '10:00:00', '10:45:00', { subjectBn: 'বাংলা', sectionLabel: '৯-ক', roomCode: '১০১' }),
    slot(2, '10:50:00', '11:35:00', { subjectBn: 'ইংরেজি', sectionLabel: '৯-খ', roomCode: '১০২' }),
    slot(3, '11:40:00', '12:25:00', { subjectBn: 'গণিত', sectionLabel: '১০-ক', roomCode: '২০৪' }),
    slot(4, '12:25:00', '13:00:00', { subjectBn: 'টিফিন বিরতি', slotKind: 'break', studentCount: null }),
    slot(5, '13:00:00', '13:45:00', {
      subjectBn: 'পদার্থবিজ্ঞান', sectionLabel: '৯-ক', roomCode: '১০১',
      isSubstitution: true, coveringForBn: 'রহিম উদ্দিন',
    }),
    slot(6, '13:50:00', '14:35:00', { subjectBn: 'রসায়ন', sectionLabel: '১০-ক', roomCode: '২০৪', attendanceTaken: true }),
  ];
}

function weekDays(weekStart: string): { date: string; slots: RoutineSlot[] }[] {
  const start = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    return { date, slots: daySlots(date) };
  });
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString();
}

const DEMO_PERF_CHOICES = [
  { examSubjectId: 'es-1', label: 'নবম-ক · পদার্থবিজ্ঞান · ১ম সাময়িক' },
  { examSubjectId: 'es-2', label: 'নবম-ক · গণিত · ১ম সাময়িক' },
];

const DEMO_ASSIGNMENTS = [
  {
    id: 'demo-a-1', titleBn: 'গতির সমীকরণ — অনুশীলনী ৫.২', dueAt: inDays(2),
    status: 'open', maxMarks: '10.00', subjectBn: 'পদার্থবিজ্ঞান', sectionName: 'ক',
    submissionCount: 24, ungradedCount: 6, mySubmission: null,
  },
  {
    id: 'demo-a-2', titleBn: 'উৎপাদক বিশ্লেষণ — ১০টি সমস্যা', dueAt: inDays(5),
    status: 'open', maxMarks: '20.00', subjectBn: 'গণিত', sectionName: 'ক',
    submissionCount: 11, ungradedCount: 2,
    mySubmission: { submittedAt: inDays(-1), marksAwarded: null, gradedAt: null },
  },
  {
    id: 'demo-a-3', titleBn: 'রচনা: বিজ্ঞান ও প্রযুক্তি', dueAt: inDays(-3),
    status: 'open', maxMarks: '15.00', subjectBn: 'বাংলা', sectionName: 'ক',
    submissionCount: 28, ungradedCount: 0,
    mySubmission: { submittedAt: inDays(-4), marksAwarded: '13.00', gradedAt: inDays(-2) },
  },
];

function demoAssignmentDetail(id: string) {
  const base = DEMO_ASSIGNMENTS.find((a) => a.id === id) ?? DEMO_ASSIGNMENTS[0];
  return {
    assignment: {
      id: base.id, titleBn: base.titleBn,
      instructionsBn: 'পাঠ্যবইয়ের অনুশীলনী দেখে প্রতিটি ধাপ দেখিয়ে সমাধান করো। শুধু উত্তর লিখলে পূর্ণ নম্বর পাবে না।',
      maxMarks: base.maxMarks, dueAt: base.dueAt, allowsLate: true,
      status: 'open', subjectBn: base.subjectBn, sectionName: base.sectionName,
    },
    // With `rowVersion` and `gradedByName`, as the service sends them: the
    // grading screen sends the version back, and a grade without it is
    // refused as a client bug (F-103).
    submissions: demoSubmissionsVisible(base.id),
  };
}

const DEMO_NEXT = [
  {
    kind: 'assignment', titleBn: 'গতির সমীকরণ — অনুশীলনী ৫.২',
    whyBn: '২ দিনের মধ্যে জমা দিতে হবে', route: 'assignments',
    refId: 'demo-a-1', urgency: 'high',
  },
  {
    kind: 'redo_practice', titleBn: 'ত্বরণ',
    whyBn: '১টি প্রশ্ন এখনো ভুল আছে — আবার চেষ্টা করো', route: 'learn',
    refId: 'demo-l-3', urgency: 'medium',
  },
  {
    // The topic `demo-l-4` opens — the title on home and the lesson it
    // leads to are one lesson (minor 31).
    kind: 'continue_topic', titleBn: 'গতির সমীকরণ',
    whyBn: 'অধ্যায় ৫: গতি অধ্যায়টি শেষ করো', route: 'learn',
    refId: 'demo-l-4', urgency: 'medium',
  },
];

const DEMO_PRACTICE = [
  {
    id: 'demo-q-1', questionNo: 1, kind: 'mcq',
    stemBn: 'একটি বস্তুর বেগ ৫ সেকেন্ডে ১০ m/s থেকে ৩০ m/s হলে ত্বরণ কত?',
    explanationBn: 'a = (v − u)/t = (৩০ − ১০)/৫ = ৪ m/s²। বেগের পরিবর্তনকে সময় দিয়ে ভাগ করলেই ত্বরণ পাওয়া যায়।',
    difficulty: 2, numericAnswer: null, numericTolerance: null,
    options: [
      { id: 'demo-o-1a', optionNo: 1, textBn: '২ m/s²', isCorrect: false },
      { id: 'demo-o-1b', optionNo: 2, textBn: '৪ m/s²', isCorrect: true },
      { id: 'demo-o-1c', optionNo: 3, textBn: '৬ m/s²', isCorrect: false },
      { id: 'demo-o-1d', optionNo: 4, textBn: '৮ m/s²', isCorrect: false },
    ],
    myProgress: { attempts: 0, solved: false, lastResponseMs: null },
  },
  {
    id: 'demo-q-2', questionNo: 2, kind: 'true_false',
    stemBn: 'ত্বরণ একটি স্কেলার রাশি।',
    explanationBn: 'ভুল — ত্বরণ ভেক্টর রাশি, কারণ এর মান ও দিক দুটোই আছে।',
    difficulty: 1, numericAnswer: null, numericTolerance: null,
    options: [
      { id: 'demo-o-2a', optionNo: 1, textBn: 'সত্য', isCorrect: false },
      { id: 'demo-o-2b', optionNo: 2, textBn: 'মিথ্যা', isCorrect: true },
    ],
    myProgress: { attempts: 1, solved: true, lastResponseMs: 8400 },
  },
  {
    id: 'demo-q-3', questionNo: 3, kind: 'numeric',
    stemBn: 'একটি বাস ৮ সেকেন্ডে ২৪ m/s থেকে থেমে গেলে তার মন্দন কত (m/s²)? ঋণাত্মক চিহ্ন ছাড়া লেখো।',
    explanationBn: 'a = (০ − ২৪)/৮ = −৩ m/s²। মান ৩, দিক বেগের বিপরীতে — তাই একে মন্দন বলে।',
    difficulty: 3, numericAnswer: '3', numericTolerance: '0.01',
    options: [],
    myProgress: { attempts: 0, solved: false, lastResponseMs: null },
  },
];

/**
 * F-805 demo data, built to wireframe §6.5's own example: a Class 9 Science
 * student with an optional 4th subject, so the mandatory footnote and the
 * ⁴ superscript both render. Three terms, so the trend row has something to
 * show.
 */
const DEMO_RESULTS = [
  {
    examId: 'demo-ex-3', examNameBn: 'বার্ষিক পরীক্ষা', examType: 'term',
    totalMarks: '742', totalMax: '900', percentage: '82.4', gpa: '4.72',
    letterGrade: 'A+', subjectsFailed: 0, isPass: true, rankInSection: 5,
    publishedAt: '2026-08-12T09:00:00Z',
    subjects: [
      { subjectBn: 'বাংলা', cqMarks: '52', mcqMarks: '23', practicalMarks: null, caMarks: null, totalMarks: '75', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'ইংরেজি', cqMarks: '55', mcqMarks: '22', practicalMarks: null, caMarks: null, totalMarks: '77', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'গণিত', cqMarks: '58', mcqMarks: '26', practicalMarks: null, caMarks: null, totalMarks: '84', gradeLetter: 'A+', gradePoint: '5.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'পদার্থবিজ্ঞান', cqMarks: '44', mcqMarks: '19', practicalMarks: '22', caMarks: null, totalMarks: '85', gradeLetter: 'A+', gradePoint: '5.00', isAbsent: false, requirementType: 'group_compulsory' },
      { subjectBn: 'রসায়ন', cqMarks: '41', mcqMarks: '18', practicalMarks: '21', caMarks: null, totalMarks: '80', gradeLetter: 'A+', gradePoint: '5.00', isAbsent: false, requirementType: 'group_compulsory' },
      { subjectBn: 'জীববিজ্ঞান', cqMarks: '38', mcqMarks: '17', practicalMarks: '20', caMarks: null, totalMarks: '75', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'group_compulsory' },
      { subjectBn: 'ইসলাম ও নৈতিক শিক্ষা', cqMarks: '48', mcqMarks: '21', practicalMarks: null, caMarks: null, totalMarks: '69', gradeLetter: 'A-', gradePoint: '3.50', isAbsent: false, requirementType: 'religion_variant' },
      { subjectBn: 'উচ্চতর গণিত', cqMarks: '44', mcqMarks: '20', practicalMarks: null, caMarks: null, totalMarks: '64', gradeLetter: 'A-', gradePoint: '3.50', isAbsent: false, requirementType: 'optional' },
    ],
  },
  {
    examId: 'demo-ex-2', examNameBn: 'দ্বিতীয় সাময়িক', examType: 'term',
    totalMarks: '688', totalMax: '900', percentage: '76.4', gpa: '4.31',
    letterGrade: 'A', subjectsFailed: 0, isPass: true, rankInSection: 9,
    publishedAt: '2026-05-20T09:00:00Z',
    subjects: [
      { subjectBn: 'বাংলা', cqMarks: '46', mcqMarks: '20', practicalMarks: null, caMarks: null, totalMarks: '66', gradeLetter: 'A-', gradePoint: '3.50', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'গণিত', cqMarks: '50', mcqMarks: '24', practicalMarks: null, caMarks: null, totalMarks: '74', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'পদার্থবিজ্ঞান', cqMarks: '40', mcqMarks: '16', practicalMarks: '19', caMarks: null, totalMarks: '75', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'group_compulsory' },
      { subjectBn: 'উচ্চতর গণিত', cqMarks: '39', mcqMarks: '18', practicalMarks: null, caMarks: null, totalMarks: '57', gradeLetter: 'B', gradePoint: '3.00', isAbsent: false, requirementType: 'optional' },
    ],
  },
  {
    examId: 'demo-ex-1', examNameBn: 'প্রথম সাময়িক', examType: 'term',
    totalMarks: '702', totalMax: '900', percentage: '78.0', gpa: '4.56',
    letterGrade: 'A', subjectsFailed: 0, isPass: true, rankInSection: 7,
    publishedAt: '2026-02-18T09:00:00Z',
    subjects: [
      { subjectBn: 'বাংলা', cqMarks: '48', mcqMarks: '22', practicalMarks: null, caMarks: null, totalMarks: '70', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'ইংরেজি', cqMarks: '52', mcqMarks: '20', practicalMarks: null, caMarks: null, totalMarks: '72', gradeLetter: 'A', gradePoint: '4.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'গণিত', cqMarks: '55', mcqMarks: '25', practicalMarks: null, caMarks: null, totalMarks: '80', gradeLetter: 'A+', gradePoint: '5.00', isAbsent: false, requirementType: 'compulsory' },
      { subjectBn: 'পদার্থবিজ্ঞান', cqMarks: '42', mcqMarks: '18', practicalMarks: '21', caMarks: null, totalMarks: '81', gradeLetter: 'A+', gradePoint: '5.00', isAbsent: false, requirementType: 'group_compulsory' },
      { subjectBn: 'উচ্চতর গণিত', cqMarks: '44', mcqMarks: '20', practicalMarks: null, caMarks: null, totalMarks: '64', gradeLetter: 'A-', gradePoint: '3.50', isAbsent: false, requirementType: 'optional' },
    ],
  },
];

/**
 * The chapters behind আমার বিষয় (finding 15).
 *
 * Every chapter here used to carry `demo-sub-phy` or `demo-sub-math`, which
 * no id on আমার বিষয় (`demo-sub-136`, `demo-sub-109`, …) ever matched — so
 * tapping any subject, গণিত included, opened পড়াশোনা on physics. Each
 * subject now has its own chapters under the id DEMO_SUBJECTS gives it, and
 * the chapter each subject card names as "next" is one of them.
 */
const DEMO_CHAPTER_SPECS: Array<{
  id: string; chapterNo: number; bn: string; en: string; summaryBn: string;
  subject: { id: string; bn: string; en: string };
  prerequisite: { id: string; nameBn: string } | null;
  topics: string[]; completed: number;
}> = (() => {
  const S = {
    ban: { id: 'demo-sub-101', bn: 'বাংলা', en: 'Bangla' },
    eng: { id: 'demo-sub-107', bn: 'ইংরেজি', en: 'English' },
    mat: { id: 'demo-sub-109', bn: 'গণিত', en: 'Mathematics' },
    bgs: { id: 'demo-sub-150', bn: 'বাংলাদেশ ও বিশ্বপরিচয়', en: 'Bangladesh and Global Studies' },
    phy: { id: 'demo-sub-136', bn: 'পদার্থবিজ্ঞান', en: 'Physics' },
    che: { id: 'demo-sub-137', bn: 'রসায়ন', en: 'Chemistry' },
    bio: { id: 'demo-sub-138', bn: 'জীববিজ্ঞান', en: 'Biology' },
    isl: { id: 'demo-sub-111', bn: 'ইসলাম ও নৈতিক শিক্ষা', en: 'Islam and Moral Education' },
    hmt: { id: 'demo-sub-126', bn: 'উচ্চতর গণিত', en: 'Higher Mathematics' },
  };
  return [
    { id: 'demo-ch-b9', chapterNo: 9, bn: 'অধ্যায় ৯: আম-আঁটির ভেঁপু', en: 'Chapter 9: Aam-Atir Bhenpu',
      summaryBn: 'বিভূতিভূষণ বন্দ্যোপাধ্যায়ের গল্পে অপু-দুর্গার শৈশব ও গ্রামবাংলার জীবন।',
      subject: S.ban, prerequisite: null, completed: 4,
      topics: ['লেখক পরিচিতি', 'গল্পের মূলভাব', 'শব্দার্থ ও টীকা', 'সৃজনশীল প্রশ্ন অনুশীলন'] },
    { id: 'demo-ch-b10', chapterNo: 10, bn: 'অধ্যায় ১০: অপরিচিতা', en: 'Chapter 10: Aparichita',
      summaryBn: 'রবীন্দ্রনাথ ঠাকুরের গল্পে যৌতুকপ্রথার বিরুদ্ধে কল্যাণীর দৃঢ় অবস্থান।',
      subject: S.ban, prerequisite: null, completed: 1,
      topics: ['লেখক পরিচিতি', 'গল্পের মূলভাব', 'চরিত্র বিশ্লেষণ: কল্যাণী', 'সৃজনশীল প্রশ্ন অনুশীলন'] },
    { id: 'demo-ch-e11', chapterNo: 11, bn: 'ইউনিট ১১: ট্রাফিক শিক্ষা', en: 'Unit 11: Traffic Education',
      summaryBn: 'সড়ক নিরাপত্তার নিয়ম নিয়ে পাঠ, শব্দভান্ডার ও প্রশ্নোত্তর।',
      subject: S.eng, prerequisite: null, completed: 3,
      topics: ['পাঠ: সড়ক নিরাপত্তা', 'শব্দভান্ডার', 'লিখন অনুশীলন'] },
    { id: 'demo-ch-e12', chapterNo: 12, bn: 'ইউনিট ১২: আমাদের পরিবেশ', en: 'Unit 12: Our Environment',
      summaryBn: 'পরিবেশ দূষণ ও তার প্রতিকার নিয়ে পাঠ এবং অনুচ্ছেদ লিখন।',
      subject: S.eng, prerequisite: null, completed: 3,
      topics: ['পাঠ: পরিবেশ দূষণ', 'শব্দভান্ডার', 'অনুচ্ছেদ লিখন'] },
    { id: 'demo-ch-3', chapterNo: 3, bn: 'অধ্যায় ৩: বীজগণিতিক রাশি', en: 'Chapter 3: Algebraic Expressions',
      summaryBn: 'উৎপাদক বিশ্লেষণ ও দ্বিঘাত সমীকরণের সমাধান।',
      subject: S.mat, prerequisite: null, completed: 4,
      topics: ['বীজগণিতীয় সূত্রাবলি', 'উৎপাদকে বিশ্লেষণ', 'গুণনীয়ক ও গুণিতক', 'দ্বিঘাত সমীকরণের সমাধান'] },
    { id: 'demo-ch-m12', chapterNo: 12, bn: 'অধ্যায় ১২: দুই চলকবিশিষ্ট সরল সহসমীকরণ',
      en: 'Chapter 12: Simultaneous Linear Equations',
      summaryBn: 'প্রতিস্থাপন, অপনয়ন ও লেখচিত্রের সাহায্যে সহসমীকরণের সমাধান।',
      subject: S.mat, prerequisite: { id: 'demo-ch-3', nameBn: 'অধ্যায় ৩: বীজগণিতিক রাশি' }, completed: 0,
      topics: ['সরল সহসমীকরণের ধারণা', 'প্রতিস্থাপন পদ্ধতি', 'অপনয়ন পদ্ধতি', 'লেখচিত্রের সাহায্যে সমাধান'] },
    { id: 'demo-ch-g5', chapterNo: 5, bn: 'অধ্যায় ৫: রাষ্ট্র ও সরকার', en: 'Chapter 5: State and Government',
      summaryBn: 'রাষ্ট্রের উপাদান, সরকারের তিনটি অঙ্গ ও স্থানীয় সরকার।',
      subject: S.bgs, prerequisite: null, completed: 3,
      topics: ['রাষ্ট্রের উপাদান', 'সরকারের অঙ্গসমূহ', 'স্থানীয় সরকার'] },
    { id: 'demo-ch-g6', chapterNo: 6, bn: 'অধ্যায় ৬: বাংলাদেশের অর্থনীতি', en: 'Chapter 6: Economy of Bangladesh',
      summaryBn: 'কৃষি, শিল্প ও সেবা খাত এবং জাতীয় আয়ের ধারণা।',
      subject: S.bgs, prerequisite: null, completed: 1,
      topics: ['কৃষি খাত', 'শিল্প খাত', 'জাতীয় আয়'] },
    { id: 'demo-ch-1', chapterNo: 5, bn: 'অধ্যায় ৫: গতি', en: 'Chapter 5: Motion',
      summaryBn: 'সরণ, দ্রুতি, বেগ ও ত্বরণের ধারণা এবং নিউটনের সূত্র।',
      subject: S.phy, prerequisite: null, completed: 2,
      topics: ['সরণ ও দূরত্ব', 'দ্রুতি ও বেগ', 'ত্বরণ', 'গতির সমীকরণ'] },
    { id: 'demo-ch-2', chapterNo: 6, bn: 'অধ্যায় ৬: বল ও নিউটনের সূত্র', en: 'Chapter 6: Force',
      summaryBn: 'বলের প্রকারভেদ, নিউটনের তিনটি সূত্র ও তাদের প্রয়োগ।',
      subject: S.phy, prerequisite: { id: 'demo-ch-1', nameBn: 'অধ্যায় ৫: গতি' }, completed: 0,
      topics: ['বলের ধারণা', 'সাম্য ও অসাম্য বল', 'নিউটনের প্রথম সূত্র ও জড়তা',
        'নিউটনের দ্বিতীয় সূত্র', 'নিউটনের তৃতীয় সূত্র'] },
    { id: 'demo-ch-p9', chapterNo: 9, bn: 'অধ্যায় ৯: তরঙ্গ ও শব্দ', en: 'Chapter 9: Waves and Sound',
      summaryBn: 'তরঙ্গের প্রকারভেদ ও বৈশিষ্ট্য, শব্দের বিস্তার ও প্রতিধ্বনি।',
      subject: S.phy, prerequisite: null, completed: 0,
      topics: ['তরঙ্গ ও তার প্রকারভেদ', 'তরঙ্গের বৈশিষ্ট্য', 'শব্দের উৎপত্তি ও বিস্তার', 'প্রতিধ্বনি'] },
    { id: 'demo-ch-c6', chapterNo: 6, bn: 'অধ্যায় ৬: মোলের ধারণা ও রাসায়নিক গণনা',
      en: 'Chapter 6: Mole Concept', summaryBn: 'মোল, মোলার ভর ও দ্রবণের ঘনমাত্রার হিসাব।',
      subject: S.che, prerequisite: null, completed: 4,
      topics: ['মোলের ধারণা', 'মোলার ভর', 'রাসায়নিক সংকেত থেকে গণনা', 'দ্রবণের ঘনমাত্রা'] },
    { id: 'demo-ch-c7', chapterNo: 7, bn: 'অধ্যায় ৭: রাসায়নিক বিক্রিয়া', en: 'Chapter 7: Chemical Reactions',
      summaryBn: 'বিক্রিয়ার প্রকারভেদ, জারণ-বিজারণ ও সমীকরণের সমতাকরণ।',
      subject: S.che, prerequisite: { id: 'demo-ch-c6', nameBn: 'অধ্যায় ৬: মোলের ধারণা ও রাসায়নিক গণনা' },
      completed: 0,
      topics: ['রাসায়নিক বিক্রিয়ার ধারণা', 'জারণ-বিজারণ', 'রাসায়নিক সমীকরণের সমতাকরণ', 'বিক্রিয়ার হার'] },
    { id: 'demo-ch-bio4', chapterNo: 4, bn: 'অধ্যায় ৪: কোষ বিভাজন', en: 'Chapter 4: Cell Division',
      summaryBn: 'মাইটোসিস ও মিয়োসিস — কখন, কেন এবং কীভাবে কোষ বিভাজিত হয়।',
      subject: S.bio, prerequisite: null, completed: 3,
      topics: ['কোষ বিভাজনের ধারণা', 'মাইটোসিস', 'মিয়োসিস'] },
    { id: 'demo-ch-b5', chapterNo: 5, bn: 'অধ্যায় ৫: অঙ্গ ও অঙ্গতন্ত্র', en: 'Chapter 5: Organs and Systems',
      summaryBn: 'টিস্যু থেকে অঙ্গ, আর অঙ্গ থেকে পরিপাক ও শ্বসনতন্ত্র।',
      subject: S.bio, prerequisite: { id: 'demo-ch-bio4', nameBn: 'অধ্যায় ৪: কোষ বিভাজন' }, completed: 0,
      topics: ['টিস্যু ও অঙ্গ', 'পরিপাকতন্ত্র', 'শ্বসনতন্ত্র'] },
    { id: 'demo-ch-i7', chapterNo: 7, bn: 'অধ্যায় ৭: আখলাক', en: 'Chapter 7: Akhlaq',
      summaryBn: 'উত্তম চরিত্রের গুণাবলি এবং যা বর্জন করতে হয়।',
      subject: S.isl, prerequisite: null, completed: 3,
      topics: ['আখলাকের ধারণা', 'আখলাকে হামিদা', 'আখলাকে যামিমা'] },
    { id: 'demo-ch-i8', chapterNo: 8, bn: 'অধ্যায় ৮: ইবাদত', en: 'Chapter 8: Ibadat',
      summaryBn: 'ইবাদতের তাৎপর্য, সালাত ও সাওমের বিধান।',
      subject: S.isl, prerequisite: null, completed: 1,
      topics: ['ইবাদতের ধারণা', 'সালাত', 'সাওম'] },
    { id: 'demo-ch-h4', chapterNo: 4, bn: 'অধ্যায় ৪: বহুপদী ও বহুপদী সমীকরণ',
      en: 'Chapter 4: Polynomials', summaryBn: 'ভাগশেষ ও উৎপাদক উপপাদ্য, বহুপদী সমীকরণের মূল।',
      subject: S.hmt, prerequisite: null, completed: 4,
      topics: ['বহুপদীর ধারণা', 'ভাগশেষ উপপাদ্য', 'উৎপাদক উপপাদ্য', 'বহুপদী সমীকরণ'] },
    { id: 'demo-ch-h5', chapterNo: 5, bn: 'অধ্যায় ৫: সমীকরণ ও অসমতা', en: 'Chapter 5: Equations and Inequalities',
      summaryBn: 'দ্বিঘাত সমীকরণের মূল ও সহগ, অসমতা ও তার লেখচিত্র।',
      subject: S.hmt, prerequisite: { id: 'demo-ch-h4', nameBn: 'অধ্যায় ৪: বহুপদী ও বহুপদী সমীকরণ' },
      completed: 0,
      topics: ['দ্বিঘাত সমীকরণ', 'মূল ও সহগের সম্পর্ক', 'অসমতার ধারণা', 'অসমতার লেখচিত্র'] },
  ];
})();

/** Shaped as GET /academics/chapters answers, `prerequisites` list included. */
const DEMO_CHAPTERS = DEMO_CHAPTER_SPECS.map((c) => ({
  id: c.id, chapterNo: c.chapterNo,
  name: { bn: c.bn, en: c.en },
  summaryBn: c.summaryBn,
  estMinutes: c.topics.length * 25, isPublished: true,
  subject: c.subject,
  prerequisites: c.prerequisite ? [c.prerequisite] : [],
  prerequisite: c.prerequisite,
  topicCount: c.topics.length, completedCount: c.completed,
}));

/**
 * A chapter's topics. The motion chapter keeps its long-standing ids
 * (`demo-l-*`), because the student home's "next" suggestions point at them.
 */
function demoTopicsOf(chapterId: string) {
  const c = DEMO_CHAPTER_SPECS.find((x) => x.id === chapterId);
  if (!c) return [];
  return c.topics.map((bn, i) => ({
    id: c.id === 'demo-ch-1' ? `demo-l-${i + 1}` : `${c.id}-t${i + 1}`,
    topicNo: i + 1,
    title: { bn, en: null },
    estMinutes: 20 + (i % 2) * 5,
    isPublished: true,
    progress: i < c.completed
      ? { state: 'completed', secondsSpent: 1100 + i * 160 }
      : i === c.completed && c.completed > 0
        ? { state: 'started', secondsSpent: 310 }
        : null,
  }));
}

const ACCELERATION_BLOCKS = [
  { id: 'b1', blockNo: 1, kind: 'text', bodyBn: 'কোনো বস্তুর বেগ যদি সময়ের সাথে পরিবর্তিত হয়, তবে সেই পরিবর্তনের হারকে ত্বরণ বলে। ত্বরণ একটি ভেক্টর রাশি — এর মান ও দিক উভয়ই আছে।', mediaKey: null, altTextBn: null, captionBn: null },
  { id: 'b2', blockNo: 2, kind: 'formula', bodyBn: 'a = (v − u) / t', mediaKey: null, altTextBn: null, captionBn: null },
  { id: 'b3', blockNo: 3, kind: 'key_point', bodyBn: 'ত্বরণের একক m/s² — বেগের একক (m/s) কে সময় (s) দিয়ে ভাগ করলে এটি পাওয়া যায়।', mediaKey: null, altTextBn: null, captionBn: null },
  { id: 'b4', blockNo: 4, kind: 'example', bodyBn: 'একটি গাড়ি ৫ সেকেন্ডে ১০ m/s থেকে ৩০ m/s বেগ অর্জন করলে, a = (৩০ − ১০) / ৫ = ৪ m/s²।', mediaKey: null, altTextBn: null, captionBn: null },
  { id: 'b5', blockNo: 5, kind: 'text', bodyBn: 'যদি বেগ কমতে থাকে, ত্বরণ ঋণাত্মক হয় — একে মন্দন (deceleration) বলা হয়।', mediaKey: null, altTextBn: null, captionBn: null },
  { id: 'b6', blockNo: 6, kind: 'practice_prompt', bodyBn: 'একটি বাস ৮ সেকেন্ডে ২৪ m/s থেকে থেমে গেলে তার মন্দন কত? (উত্তর নিজে বের করার চেষ্টা করো)', mediaKey: null, altTextBn: null, captionBn: null },
];

/**
 * One topic to read. ত্বরণ is written out in full. Every other topic reads
 * its own title and its chapter's summary, rather than the acceleration
 * lesson under another name — which is what any id used to return.
 */
function demoTopic(topicId: string) {
  let chapter: typeof DEMO_CHAPTER_SPECS[number] | undefined;
  let topic: ReturnType<typeof demoTopicsOf>[number] | undefined;
  for (const c of DEMO_CHAPTER_SPECS) {
    topic = demoTopicsOf(c.id).find((t) => t.id === topicId);
    if (topic) { chapter = c; break; }
  }
  if (!chapter || !topic || topicId === 'demo-l-3') {
    return {
      topic: {
        id: topicId, topicNo: 3,
        title: { bn: 'ত্বরণ', en: 'Acceleration' },
        estMinutes: 20,
        chapter: { id: 'demo-ch-1', nameBn: 'অধ্যায় ৫: গতি' },
        progress: { state: 'started', secondsSpent: 310, lastBlockNo: 2 },
      },
      blocks: ACCELERATION_BLOCKS,
    };
  }
  const t = topic;
  const block = (blockNo: number, kind: string, bodyBn: string) => ({
    id: `${t.id}-b${blockNo}`, blockNo, kind, bodyBn, mediaKey: null, altTextBn: null, captionBn: null,
  });
  return {
    topic: {
      id: t.id, topicNo: t.topicNo, title: t.title, estMinutes: t.estMinutes,
      chapter: { id: chapter.id, nameBn: chapter.bn },
      progress: t.progress ? { ...t.progress, lastBlockNo: 1 } : null,
    },
    blocks: [
      block(1, 'text', `${chapter.bn} — ${chapter.summaryBn}`),
      block(2, 'key_point',
        `এই পাঠের বিষয়: ${t.title.bn}। পাঠ্যবইয়ের সংশ্লিষ্ট অংশ পড়ে মূল কথাগুলো খাতায় লিখে রাখো।`),
      block(3, 'practice_prompt', `${t.title.bn} থেকে নিজে একটি প্রশ্ন তৈরি করে তার উত্তর লেখার চেষ্টা করো।`),
    ],
  };
}

/**
 * One family's bills — the two children of the guardian preview (DEMO_WARDS).
 * Shaped as GET /finance/invoices answers, `studentId` included: the fee
 * screen groups a guardian's bills by it and names each child from the ward
 * list, so a fixture without it showed every bill under nobody.
 */
const DEMO_INVOICES = [
  {
    id: 'demo-inv-1',
    invoiceNo: 'INV-2026-08-00001',
    studentId: 'demo-s1',
    billingPeriod: '2026-08',
    issuedOn: '2026-08-01',
    dueOn: '2026-08-10',
    subtotal: '1250.00',
    waiverTotal: '0.00',
    lateFee: '0.00',
    totalAmount: '1250.00',
    paidAmount: '0.00',
    balanceAmount: '1250.00',
    status: 'issued',
    currency: 'BDT',
    lines: [
      { descriptionBn: 'মাসিক বেতন', amount: '1000.00', waiverAmount: '0.00', netAmount: '1000.00' },
      { descriptionBn: 'পরিবহন ফি', amount: '250.00', waiverAmount: '0.00', netAmount: '250.00' },
    ],
  },
  {
    id: 'demo-inv-4',
    invoiceNo: 'INV-2026-08-00002',
    studentId: 'demo-s2',
    billingPeriod: '2026-08',
    issuedOn: '2026-08-01',
    dueOn: '2026-08-10',
    subtotal: '1100.00',
    waiverTotal: '0.00',
    lateFee: '0.00',
    totalAmount: '1100.00',
    paidAmount: '0.00',
    balanceAmount: '1100.00',
    status: 'issued',
    currency: 'BDT',
    lines: [
      { descriptionBn: 'মাসিক বেতন', amount: '850.00', waiverAmount: '0.00', netAmount: '850.00' },
      { descriptionBn: 'পরিবহন ফি', amount: '250.00', waiverAmount: '0.00', netAmount: '250.00' },
    ],
  },
  {
    id: 'demo-inv-2',
    invoiceNo: 'INV-2026-07-00001',
    studentId: 'demo-s1',
    billingPeriod: '2026-07',
    issuedOn: '2026-07-01',
    dueOn: '2026-07-10',
    subtotal: '1250.00',
    waiverTotal: '0.00',
    lateFee: '0.00',
    totalAmount: '1250.00',
    paidAmount: '1250.00',
    balanceAmount: '0.00',
    status: 'paid',
    currency: 'BDT',
    lines: [
      { descriptionBn: 'মাসিক বেতন', amount: '1000.00', waiverAmount: '0.00', netAmount: '1000.00' },
      { descriptionBn: 'পরিবহন ফি', amount: '250.00', waiverAmount: '0.00', netAmount: '250.00' },
    ],
  },
  {
    id: 'demo-inv-5',
    invoiceNo: 'INV-2026-07-00002',
    studentId: 'demo-s2',
    billingPeriod: '2026-07',
    issuedOn: '2026-07-01',
    dueOn: '2026-07-10',
    subtotal: '1100.00',
    waiverTotal: '0.00',
    lateFee: '0.00',
    totalAmount: '1100.00',
    paidAmount: '1100.00',
    balanceAmount: '0.00',
    status: 'paid',
    currency: 'BDT',
    lines: [
      { descriptionBn: 'মাসিক বেতন', amount: '850.00', waiverAmount: '0.00', netAmount: '850.00' },
      { descriptionBn: 'পরিবহন ফি', amount: '250.00', waiverAmount: '0.00', netAmount: '250.00' },
    ],
  },
  {
    id: 'demo-inv-3',
    invoiceNo: 'INV-2026-06-00001',
    studentId: 'demo-s1',
    billingPeriod: '2026-06',
    issuedOn: '2026-06-01',
    dueOn: '2026-06-10',
    subtotal: '1000.00',
    waiverTotal: '250.00',
    lateFee: '0.00',
    totalAmount: '750.00',
    paidAmount: '750.00',
    balanceAmount: '0.00',
    status: 'paid',
    currency: 'BDT',
    lines: [
      { descriptionBn: 'মাসিক বেতন', amount: '1000.00', waiverAmount: '250.00', netAmount: '750.00' },
    ],
  },
];

const DEMO_CQ = `উদ্দীপক: রফিক একটি ৫ কেজি ভরের বস্তুকে ১০ নিউটন বল প্রয়োগ করে মেঝেতে ঠেলছে।

ক) বল কাকে বলে? (জ্ঞান — ১ নম্বর)
খ) নিউটনের দ্বিতীয় সূত্রটি ব্যাখ্যা করো। (অনুধাবন — ২ নম্বর)
গ) উদ্দীপকের বস্তুটির ত্বরণ নির্ণয় করো। (প্রয়োগ — ৩ নম্বর)
ঘ) বল দ্বিগুণ ও ভর অর্ধেক করা হলে ত্বরণের কী পরিবর্তন হবে — গাণিতিকভাবে বিশ্লেষণ করো। (উচ্চতর দক্ষতা — ৪ নম্বর)

(ডেমো মোড — আসল SikhokAI চালু হলে NCTB পাঠ্যবই থেকে অধ্যায়-নির্দিষ্ট প্রশ্ন তৈরি হবে।)`;

/**
 * F-802 demo data. A real Class 9 Science subject set: four compulsory,
 * three group-compulsory, one religion variant and one optional — the same
 * shape db/tests/subject_model.sql asserts, so the demo cannot drift into
 * showing a set the schema would not produce.
 */
const DEMO_SUBJECTS = [
  { subjectId: 'demo-sub-101', nameBn: 'বাংলা', nctbCode: '101', requirementType: 'compulsory',
    requirementLabelBn: 'আবশ্যিক', totalChapters: 14, completedChapters: 9, progressPercent: 64,
    nextChapter: { id: 'demo-ch-b10', chapterNo: 10, nameBn: 'অপরিচিতা' } },
  { subjectId: 'demo-sub-107', nameBn: 'ইংরেজি', nctbCode: '107', requirementType: 'compulsory',
    requirementLabelBn: 'আবশ্যিক', totalChapters: 12, completedChapters: 12, progressPercent: 100,
    nextChapter: null },
  { subjectId: 'demo-sub-109', nameBn: 'গণিত', nctbCode: '109', requirementType: 'compulsory',
    requirementLabelBn: 'আবশ্যিক', totalChapters: 17, completedChapters: 11, progressPercent: 65,
    nextChapter: { id: 'demo-ch-m12', chapterNo: 12, nameBn: 'দুই চলকবিশিষ্ট সরল সহসমীকরণ' } },
  { subjectId: 'demo-sub-150', nameBn: 'বাংলাদেশ ও বিশ্বপরিচয়', nctbCode: '150', requirementType: 'compulsory',
    requirementLabelBn: 'আবশ্যিক', totalChapters: 12, completedChapters: 5, progressPercent: 42,
    nextChapter: { id: 'demo-ch-g6', chapterNo: 6, nameBn: 'বাংলাদেশের অর্থনীতি' } },
  { subjectId: 'demo-sub-136', nameBn: 'পদার্থবিজ্ঞান', nctbCode: '136', requirementType: 'group_compulsory',
    requirementLabelBn: 'বিভাগ আবশ্যিক', totalChapters: 14, completedChapters: 8, progressPercent: 57,
    nextChapter: { id: 'demo-ch-p9', chapterNo: 9, nameBn: 'তরঙ্গ ও শব্দ' } },
  { subjectId: 'demo-sub-137', nameBn: 'রসায়ন', nctbCode: '137', requirementType: 'group_compulsory',
    requirementLabelBn: 'বিভাগ আবশ্যিক', totalChapters: 12, completedChapters: 6, progressPercent: 50,
    nextChapter: { id: 'demo-ch-c7', chapterNo: 7, nameBn: 'রাসায়নিক বিক্রিয়া' } },
  { subjectId: 'demo-sub-138', nameBn: 'জীববিজ্ঞান', nctbCode: '138', requirementType: 'group_compulsory',
    requirementLabelBn: 'বিভাগ আবশ্যিক', totalChapters: 14, completedChapters: 4, progressPercent: 29,
    nextChapter: { id: 'demo-ch-b5', chapterNo: 5, nameBn: 'অঙ্গ ও অঙ্গতন্ত্র' } },
  { subjectId: 'demo-sub-111', nameBn: 'ইসলাম ও নৈতিক শিক্ষা', nctbCode: '111', requirementType: 'religion_variant',
    requirementLabelBn: 'ধর্ম', totalChapters: 12, completedChapters: 7, progressPercent: 58,
    nextChapter: { id: 'demo-ch-i8', chapterNo: 8, nameBn: 'ইবাদত' } },
  { subjectId: 'demo-sub-126', nameBn: 'উচ্চতর গণিত', nctbCode: '126', requirementType: 'optional',
    requirementLabelBn: 'চতুর্থ বিষয়', totalChapters: 12, completedChapters: 4, progressPercent: 33,
    nextChapter: { id: 'demo-ch-h5', chapterNo: 5, nameBn: 'সমীকরণ ও অসমতা' } },
];

/**
 * F-806 demo data. Deliberately includes BOTH excused and unexcused
 * absences, because the one thing this screen has to get right is showing
 * them as different things.
 */
const DEMO_ATTENDANCE = {
  totals: { present: 96, late: 7, absent: 5, excused: 4, halfDay: 2,
            counted: 110, attendedPercent: 95 },
  byMonth: [
    { month: '2026-08', present: 6,  late: 1, absent: 0, excused: 0, halfDay: 0 },
    { month: '2026-07', present: 20, late: 2, absent: 1, excused: 1, halfDay: 0 },
    { month: '2026-06', present: 18, late: 1, absent: 3, excused: 2, halfDay: 1 },
    { month: '2026-05', present: 22, late: 2, absent: 0, excused: 0, halfDay: 0 },
    { month: '2026-04', present: 17, late: 1, absent: 1, excused: 1, halfDay: 1 },
    { month: '2026-03', present: 13, late: 0, absent: 0, excused: 0, halfDay: 0 },
  ],
  bySubject: [
    { subjectBn: 'রসায়ন',        present: 18, late: 2, absent: 3, excused: 1 },
    { subjectBn: 'পদার্থবিজ্ঞান',   present: 20, late: 1, absent: 1, excused: 1 },
    { subjectBn: 'গণিত',          present: 22, late: 2, absent: 1, excused: 0 },
    { subjectBn: 'বাংলা',         present: 21, late: 1, absent: 0, excused: 1 },
    { subjectBn: 'ইংরেজি',        present: 15, late: 1, absent: 0, excused: 1 },
  ],
  // Every day that was not "present", as the service lists them (`status <>
  // 'present'`, newest first) — so each month's দেরি, অনুপস্থিত, ছুটি and
  // অর্ধদিবস above are days a calendar can draw, and each subject's counts
  // are these days. It held seven of eighteen: August said দেরি ১ over a
  // calendar with no day coloured (minor 31). School days only — tenant A's
  // weekend is Friday and Saturday, and 19 June was a Friday.
  recent: [
    { takenOn: '2026-08-11', status: 'late',    minutesLate: 12,   remark: null, subjectBn: 'ইংরেজি' },
    { takenOn: '2026-07-22', status: 'excused', minutesLate: null, remark: 'ডাক্তারি ছুটি', subjectBn: 'পদার্থবিজ্ঞান' },
    { takenOn: '2026-07-14', status: 'late',    minutesLate: 18,   remark: null, subjectBn: 'গণিত' },
    { takenOn: '2026-07-08', status: 'absent',  minutesLate: null, remark: null, subjectBn: 'রসায়ন' },
    { takenOn: '2026-07-05', status: 'late',    minutesLate: 9,    remark: null, subjectBn: 'রসায়ন' },
    { takenOn: '2026-06-30', status: 'absent',  minutesLate: null, remark: null, subjectBn: 'রসায়ন' },
    { takenOn: '2026-06-24', status: 'late',    minutesLate: 6,    remark: null, subjectBn: 'বাংলা' },
    { takenOn: '2026-06-18', status: 'excused', minutesLate: null, remark: 'পারিবারিক অনুষ্ঠান', subjectBn: 'বাংলা' },
    { takenOn: '2026-06-11', status: 'absent',  minutesLate: null, remark: null, subjectBn: 'রসায়ন' },
    { takenOn: '2026-06-09', status: 'excused', minutesLate: null, remark: 'জ্বর', subjectBn: 'ইংরেজি' },
    { takenOn: '2026-06-04', status: 'half_day',minutesLate: null, remark: 'অসুস্থ', subjectBn: null },
    { takenOn: '2026-06-02', status: 'absent',  minutesLate: null, remark: null, subjectBn: 'পদার্থবিজ্ঞান' },
    { takenOn: '2026-05-27', status: 'late',    minutesLate: 25,   remark: null, subjectBn: 'পদার্থবিজ্ঞান' },
    { takenOn: '2026-05-12', status: 'late',    minutesLate: 14,   remark: null, subjectBn: 'গণিত' },
    { takenOn: '2026-04-28', status: 'late',    minutesLate: 11,   remark: null, subjectBn: 'রসায়ন' },
    { takenOn: '2026-04-15', status: 'absent',  minutesLate: null, remark: null, subjectBn: 'গণিত' },
    { takenOn: '2026-04-09', status: 'excused', minutesLate: null, remark: 'ডাক্তারি ছুটি', subjectBn: 'রসায়ন' },
    { takenOn: '2026-04-07', status: 'half_day',minutesLate: null, remark: 'অসুস্থ', subjectBn: null },
  ],
};

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A refusal in the shape every service's `HttpError` handler writes:
 * `{ error, message, ...detail }`. The screens read `error` to choose a
 * sentence and `field` to put it beside the right input, so a demo refusal
 * that left either out would show a different screen from the product's.
 */
function refuse(
  status: number, error: string, message: string, detail: Record<string, unknown> = {},
): Response {
  return ok({ error, message, ...detail }, status);
}

/** The request body, or `{}` — a malformed body is the server's 400, not a crash here. */
function bodyOf<T>(init: RequestInit): Partial<T> {
  try { return JSON.parse(String(init.body ?? '{}')) as Partial<T>; } catch { return {}; }
}

function methodOf(init: RequestInit): string {
  return (init.method ?? 'GET').toUpperCase();
}

/**
 * Two demo institutions — R-1's acceptance test, runnable in a browser
 * with no database.
 *
 * The requirement is that ONE deployment serves institutions with
 * completely different identities, and the only honest way to show that is
 * side by side: open ?demo=1&tenant=a and ?demo=1&tenant=b and compare the
 * login screen, the shell, the tab title and the printed letterhead.
 *
 * Deliberately unalike in every dimension the feature covers — Bangla and
 * English name, short name, logo, colour, address, contact, head teacher —
 * so a bug that leaks one tenant's value into the other shows up as an
 * obvious mismatch rather than something a reader has to hunt for.
 *
 * The logos are 24px discs generated as PNG (not SVG: the ui-core
 * validator refuses SVG, and a demo that used one would be demonstrating
 * something the product does not accept).
 */
export const DEMO_TENANTS: Record<string, { id: string; branding: Record<string, string> }> = {
  a: {
    id: 'demo-tenant-a',
    branding: {
      nameBn: 'শাহজালাল আদর্শ উচ্চ বিদ্যালয়',
      nameEn: 'Shahjalal Adarsha High School',
      shortName: 'শাহজালাল',
      logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAATUlEQVR4nGMQzbJnoCUmpOA/kZgsC4g1HK8l1DAYr0XUNhzDErpaQC3DUSyhleFwS0YtGLVg1AI6WkDzomJ4lKZ0qXDoUmXSrdKnCgYAp65CFhRKEgcAAAAASUVORK5CYII=',
      faviconUrl: '',
      primaryColor: '#156a3f',
      accentColor: '#4e7a94',
      address: 'জিন্দাবাজার, সিলেট ৩১০০',
      phone: '+8801711000001',
      email: 'office@shahjalal-high.example.edu.bd',
      website: 'https://shahjalal-high.example.edu.bd',
      watermarkUrl: '',
      headmasterName: 'মোঃ আব্দুল কাদের',
      signatureUrl: '',
    },
  },
  b: {
    id: 'demo-tenant-b',
    branding: {
      nameBn: 'নর্থ সিটি মহিলা কলেজ',
      nameEn: 'North City Women’s College',
      shortName: 'নর্থ সিটি',
      logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAATUlEQVR4nGOQtqtioCUmpOA/kZgsC4g1HK8l1DAYr0XUNhzDErpaQC3DUSyhleFwS0YtGLVg1AI6WkDzomJ4lKZ0qXDoUmXSrdKnCgYAK6dxVsAgk2IAAAAASUVORK5CYII=',
      faviconUrl: '',
      primaryColor: '#1b3e7a',
      accentColor: '#a76a47',
      address: 'উত্তরা সেক্টর ৭, ঢাকা ১২৩০',
      phone: '+8801711000002',
      email: 'info@northcity-college.example.edu.bd',
      website: 'https://northcity-college.example.edu.bd',
      watermarkUrl: '',
      headmasterName: 'অধ্যাপক সালমা বেগম',
      signatureUrl: '',
    },
  },
};

/**
 * Sample notices for the demo inbox, tagged with the roles that would hold a
 * receipt. The teacher-only notice is here specifically so a previewer can
 * switch to the student role and watch it disappear.
 */
const DEMO_NOTICES: {
  noticeId: string; title: string; body: string; category: string;
  deliveredAt: string; roles: string[];
  aboutStudent?: { id: string; nameBn: string };
}[] = [
  {
    noticeId: 'n-1', category: 'emergency',
    title: 'আগামীকাল বিদ্যালয় বন্ধ',
    body: 'আবহাওয়ার কারণে আগামীকাল সকল ক্লাস বন্ধ থাকবে। পরবর্তী নির্দেশনা এসএমএসে জানানো হবে।',
    deliveredAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    roles: ['class_teacher', 'student', 'guardian', 'principal', 'accountant'],
  },
  {
    noticeId: 'n-2', category: 'teacher',
    title: 'শিক্ষক সভা — বৃহস্পতিবার ৩টা',
    body: 'সকল শিক্ষককে শিক্ষক মিলনায়তনে উপস্থিত থাকার জন্য অনুরোধ করা হলো।',
    deliveredAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    roles: ['class_teacher', 'principal'],
  },
  {
    noticeId: 'n-3', category: 'exam',
    title: 'অর্ধবার্ষিক পরীক্ষার সূচি প্রকাশিত',
    body: 'সূচি অ্যাপের পরীক্ষার রুটিন অংশে দেখা যাবে।',
    deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    roles: ['student', 'guardian', 'class_teacher', 'principal'],
  },
  {
    noticeId: 'n-4', category: 'fee',
    title: 'সেপ্টেম্বরের বেতন পরিশোধের শেষ তারিখ ১০ তারিখ',
    body: 'নির্ধারিত তারিখের পর বিলম্ব ফি যুক্ত হবে।',
    deliveredAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    roles: ['guardian', 'accountant', 'principal'],
    aboutStudent: { id: 'demo-s1', nameBn: 'রাফির হাসান' },
  },
];

/** Read state for the demo inbox — per session, never persisted. */
const demoRead = new Set<string>();

/** The role this preview is showing, read the same way DemoAuth reads it. */
/**
 * R-3's demo institution, shaped like Part T's acceptance case: Class 9 with
 * three groups, Science carrying sections A–F, and F holding forty students
 * with a class teacher and five subject teachers.
 *
 * The demo answers R-3's endpoints locally like every other one, and it obeys
 * the same role rule the real product does — a student asking for the
 * institution dashboard is refused here too, so the preview cannot teach
 * anyone that the management screens are open to everybody.
 */
const DEMO_TEACHERS = [
  { id: 'demo-t1', nameBn: 'রহিম স্যার',  employeeCode: 'T-101', currentLoad: 4, expertiseSubjectIds: ['demo-sub1'] },
  { id: 'demo-t2', nameBn: 'করিম স্যার',  employeeCode: 'T-102', currentLoad: 3, expertiseSubjectIds: ['demo-sub1', 'demo-sub2'] },
  { id: 'demo-t3', nameBn: 'হাসান স্যার', employeeCode: 'T-103', currentLoad: 5, expertiseSubjectIds: ['demo-sub2'] },
  { id: 'demo-t4', nameBn: 'নাঈম স্যার',  employeeCode: 'T-104', currentLoad: 2, expertiseSubjectIds: ['demo-sub3'] },
  { id: 'demo-t5', nameBn: 'শুভ স্যার',   employeeCode: 'T-105', currentLoad: 6, expertiseSubjectIds: ['demo-sub4'] },
];

const R3_SUBJECTS = [
  { id: 'demo-sub1', nameBn: 'পদার্থবিজ্ঞান', nameEn: 'Physics' },
  { id: 'demo-sub2', nameBn: 'রসায়ন',        nameEn: 'Chemistry' },
  { id: 'demo-sub3', nameBn: 'জীববিজ্ঞান',    nameEn: 'Biology' },
  { id: 'demo-sub4', nameBn: 'গণিত',          nameEn: 'Mathematics' },
  { id: 'demo-sub5', nameBn: 'বাংলা',          nameEn: 'Bangla' },
];

/** Forty students, deterministic — a preview must look the same twice. */
const DEMO_SECTION_F_ROSTER = Array.from({ length: 40 }, (_, i) => ({
  studentId: `demo-s${i + 1}`,
  rollNo: i + 1,
  // Bangla numerals: the preview sits beside real Bangla counts, and a
  // Latin '12' in the roster is the kind of seam a school notices first.
  nameBn: `শিক্ষার্থী ${String(i + 1).replace(/\d/g, (c) => '০১২৩৪৫৬৭৮৯'[Number(c)])}`,
  studentCode: `2026-9F-${String(i + 1).padStart(3, '0')}`,
  status: 'active',
}));

/**
 * How many children the demo's section F holds.
 *
 * ONE constant, read by the roster fixture below AND by the capacity refusal,
 * because the first version had 40 in one and 42 in the other — and the form
 * duly said "40 enrolled" above a refusal that said "42". Two numbers for one
 * fact is how a demo teaches an office to distrust the screen.
 */
const DEMO_SECTION_ENROLLED = 40;

const DEMO_SECTIONS_SCIENCE = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({
  id: `demo-sec-${name}`,
  name,
  shift: 'morning',
  capacity: 60,
  studentCount: name === 'F' ? DEMO_SECTION_ENROLLED : 38 - i,
  classTeacher: name === 'F'
    ? { id: 'demo-t1', nameBn: 'রহিম স্যার' }
    : (i % 3 === 2 ? null : { id: `demo-t${(i % 5) + 1}`, nameBn: DEMO_TEACHERS[i % 5].nameBn }),
  subjectTeacherCount: name === 'F' ? 5 : 4,
}));


/**
 * R-3 role gates, mirroring the allowlists in the real handlers.
 *
 * The demo answers locally, so without these it answers EVERYTHING to
 * EVERYBODY — and a preview that shows a student the institution's user list
 * is teaching the opposite of what the product does. Found in the browser:
 * the student preview rendered the whole academic tree, the staff directory
 * and the result-publishing screen.
 *
 * Each set is a copy of a server allowlist, and copies drift. That is
 * acceptable here and nowhere else: this decides what a SAMPLE-DATA preview
 * draws, and the server still refuses the real request either way.
 */
const DEMO_GATES: Record<string, string[]> = {
  '/api/v1/ops/dashboard': ['principal', 'school_owner', 'academic_coordinator', 'it_admin'],
  '/api/v1/ops/assign':    ['principal', 'school_owner', 'academic_coordinator', 'it_admin'],
  '/api/v1/ops/enrol':     ['principal', 'school_owner', 'academic_coordinator', 'it_admin'],
  '/api/v1/ops/rollover':  ['principal', 'school_owner', 'academic_coordinator', 'it_admin'],
  '/api/v1/ops/users':     ['principal', 'school_owner', 'it_admin', 'academic_coordinator'],
  // P5. Ungated, so the public preview showed a STUDENT the school's SMS
  // policy and its cost figures. Mirrors SETTINGS_ROLES in ops-svc.
  '/api/v1/ops/settings':  ['principal', 'school_owner', 'it_admin', 'academic_coordinator'],
  '/api/v1/academics/publish': ['principal', 'school_owner', 'academic_coordinator'],
  '/api/v1/ops/structure':  ['principal', 'school_owner', 'academic_coordinator', 'it_admin'],
  '/api/v1/ops/guardians':  ['principal', 'school_owner', 'it_admin', 'academic_coordinator',
                             'class_teacher', 'subject_teacher', 'dept_head', 'accountant'],
  // The narrowest gate in the product: the audit trail names every change
  // anybody made, so it is three roles and no others.
  '/api/v1/ops/audit':      ['principal', 'school_owner', 'it_admin'],
  // R-4's calendar is deliberately absent from this map: every role reads it.
  // Only its WRITES are gated, and the demo answers reads only.
  '/api/v1/finance/generate':  ['principal', 'school_owner', 'accountant'],
  // P5. These three were ungated, so the PUBLIC preview showed a class
  // teacher the school's chart of accounts, its MFS reconciliation totals and
  // three invoices — which `LEDGER_ROLES` in finance-svc and `invoice_scope`
  // in migration 010 both refuse. Mirrors LEDGER_ROLES exactly.
  '/api/v1/finance/ledger':   ['principal', 'school_owner', 'accountant'],
  // Invoices are narrower than the ledger in one direction and wider in
  // another: a guardian and a student read THEIR OWN, which `invoice_scope`
  // enforces by row. The demo fixture is one family's, so the roles that may
  // see it are the family plus the money roles.
  '/api/v1/finance/invoices': ['principal', 'school_owner', 'accountant',
                               'guardian', 'student'],
  '/api/v1/finance/receipts': ['principal', 'school_owner', 'accountant',
                               'guardian', 'student'],
  // The office counter. COLLECT_ROLES in finance-svc/api/payments.ts: an
  // it_admin administers accounts, they do not stand at the counter.
  '/api/v1/finance/payments': ['principal', 'school_owner', 'accountant'],
  // §9.1's guardian panel. NOT staff-only — a class teacher legitimately looks
  // at what a guardian sees — but emphatically not a STUDENT, who would read
  // their classmates' siblings' attendance, fees and results. Mirrors
  // WARD_ROLES in services/academics-svc/api/ward.ts, which is where the
  // demo-gate test reads the expectation from.
  '/api/v1/academics/ward': ['guardian', 'principal', 'school_owner',
                             'academic_coordinator', 'class_teacher'],
  // A whole class's performance. Mirrors PERF_ROLES.
  '/api/v1/academics/classperf': ['class_teacher', 'subject_teacher',
                                  'academic_coordinator', 'principal', 'school_owner'],
  // Who takes which optional subject, for the whole cohort. CHOICE_ROLES.
  '/api/v1/academics/subjectchoice': ['principal', 'school_owner', 'academic_coordinator'],
  // The routine editor. EDITOR_ROLES.
  '/api/v1/rms/editor': ['principal', 'school_owner', 'academic_coordinator'],
  '/api/v1/rms/publish': ['principal', 'school_owner', 'academic_coordinator'],
};

/**
 * The student's own day (B-15). Not the teacher's: no student_count, no
 * attendanceTaken, no deliveryLogged — the real endpoint does not return them
 * and a demo that did would be advertising a leak the product does not have.
 *
 * Period 2 is a religion variant: the whole section is not in this room, and
 * `app.student_day` picks it from `student_subjects`. Period 4 is covered by
 * somebody else today, so it names the substitute and says so.
 */
const DEMO_STUDENT_DAY = [
  { slotId: 'demo-sd-1', periodNo: 1, startsAt: '08:00', endsAt: '08:45',
    subjectBn: 'বাংলা ১ম পত্র', subjectEn: 'Bangla 1st', sectionLabel: 'নবম — ক',
    roomCode: '১০১', teacherNameBn: 'নাজমা সুলতানা', isSubstitution: false },
  { slotId: 'demo-sd-2', periodNo: 2, startsAt: '08:50', endsAt: '09:35',
    subjectBn: 'ইসলাম ও নৈতিক শিক্ষা', subjectEn: 'Islamic Studies',
    sectionLabel: 'নবম — ক', roomCode: '১০৪', teacherNameBn: 'মাওলানা ইদ্রিস',
    isSubstitution: false },
  { slotId: 'demo-sd-3', periodNo: 3, startsAt: '09:40', endsAt: '10:25',
    subjectBn: 'গণিত', subjectEn: 'Mathematics', sectionLabel: 'নবম — ক',
    roomCode: '১০১', teacherNameBn: 'রফিকুল ইসলাম', isSubstitution: false },
  { slotId: 'demo-sd-4', periodNo: 4, startsAt: '11:00', endsAt: '11:45',
    subjectBn: 'পদার্থবিজ্ঞান', subjectEn: 'Physics', sectionLabel: 'নবম — ক',
    roomCode: 'ল্যাব-১', teacherNameBn: 'শাহনাজ পারভীন', isSubstitution: true },
  { slotId: 'demo-sd-5', periodNo: 5, startsAt: '11:50', endsAt: '12:35',
    subjectBn: 'ইংরেজি ২য় পত্র', subjectEn: 'English 2nd', sectionLabel: 'নবম — ক',
    roomCode: '১০২', teacherNameBn: 'ফারহানা ইয়াসমিন', isSubstitution: false },
];


/**
 * requireStaff: students and guardians are the blocklist, as in auth.ts.
 *
 * One entry for a long time, and wrong by six. Every path here is a module
 * under `services/*\/api` that calls `requireStaff(claims)` before answering a
 * GET, so a guardian who types a teacher's URL gets the same 403 here that the
 * server would give them — which is the only reason the screen behind it is
 * safe to leave registered for every role (R-3).
 *
 * The two POST-only gates (`academics/assignments`, `academics/scripts`) are
 * deliberately absent: their GETs are what a student's own homework list is
 * built from, and blocking those would break the student the gate exists to
 * protect. `ops/guardians` is absent for the opposite reason — DEMO_GATES
 * already names its allowed roles, and neither student nor guardian is among
 * them.
 */
const DEMO_STAFF_ONLY = new Set([
  '/api/v1/academics/hierarchy',
  '/api/v1/academics/roster',
  '/api/v1/academics/sections',
  '/api/v1/academics/exams',
  '/api/v1/academics/marks',
  '/api/v1/rms/routine',
  '/api/v1/rms/rooms',
  '/api/v1/finance/feestructures',
  '/api/v1/ops/structure',
]);

function demoForbidden(pathname: string): Response | null {
  const allowed = DEMO_GATES[pathname];
  if (allowed && !allowed.includes(demoRole())) {
    return new Response(JSON.stringify({ error: 'forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (DEMO_STAFF_ONLY.has(pathname) && ['student', 'guardian'].includes(demoRole())) {
    return new Response(JSON.stringify({ error: 'forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

/**
 * The audit fixture. Includes the redacted case — a phone number in a diff —
 * so the preview shows what the server's masking does rather than only
 * claiming it happens.
 */
const DEMO_LEDGER = {
  accounts: [
    { code: 'MFS-BKASH',  nameBn: 'bKash সংগ্রহ',   type: 'asset',  balance: '18450.00' },
    { code: 'MFS-NAGAD',  nameBn: 'Nagad সংগ্রহ',   type: 'asset',  balance: '9200.00' },
    { code: 'MFS-ROCKET', nameBn: 'Rocket সংগ্রহ',  type: 'asset',  balance: '3100.00' },
    { code: 'CASH',       nameBn: 'নগদ',            type: 'asset',  balance: '5750.00' },
    { code: 'FEE-INCOME', nameBn: 'বেতন ও ফি আয়',   type: 'income', balance: '36500.00' },
  ],
  batches: [
    {
      batchId: 'demo-b1', entryDate: '2026-08-08', memo: 'bKash-এ ফি জমা',
      lines: [
        { accountCode: 'MFS-BKASH', debit: '1250.00', credit: '0' },
        { accountCode: 'FEE-INCOME', debit: '0', credit: '1250.00' },
      ],
    },
    {
      batchId: 'demo-b2', entryDate: '2026-08-08', memo: 'Nagad-এ ফি জমা',
      lines: [
        { accountCode: 'MFS-NAGAD', debit: '750.00', credit: '0' },
        { accountCode: 'FEE-INCOME', debit: '0', credit: '750.00' },
      ],
    },
    {
      batchId: 'demo-b3', entryDate: '2026-08-07', memo: 'bKash-এ ফি জমা',
      lines: [
        { accountCode: 'MFS-BKASH', debit: '1000.00', credit: '0' },
        { accountCode: 'FEE-INCOME', debit: '0', credit: '1000.00' },
      ],
    },
  ],
  // Rocket deliberately does NOT reconcile: a preview where every figure
  // matches teaches an accountant nothing about what a mismatch looks like.
  reconciliation: [
    { provider: 'bKash',  posted: '18450.00', reconciled: '18450.00' },
    { provider: 'Nagad',  posted: '9200.00',  reconciled: '9200.00' },
    { provider: 'Rocket', posted: '3100.00',  reconciled: '2350.00' },
  ],
};

const DEMO_AUDIT = [
  {
    id: '5', at: '2026-08-28T09:12:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'ops.guardian.permissions', entityType: 'guardianship', entityId: 'demo-link-1',
    before: { canPayFees: true, receivesSms: true, phone: '•••11' },
    after: { canPayFees: false, receivesSms: true, phone: '•••11' },
  },
  {
    id: '4', at: '2026-08-27T14:40:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'academic.class_teacher.assign', entityType: 'section', entityId: 'demo-sec-F',
    before: { teacherId: 'demo-t1', nameBn: 'রহিম স্যার' },
    after: { teacherId: 'demo-t2', nameBn: 'করিম স্যার', reason: 'বদলি হয়েছেন' },
  },
  {
    id: '3', at: '2026-08-26T11:05:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'academic.section.create', entityType: 'section', entityId: 'demo-sec-G',
    before: null,
    after: { name: 'G', capacity: 55, shift: 'morning' },
  },
  {
    id: '2', at: '2026-08-25T08:30:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'exam.results.publish', entityType: 'exam', entityId: 'demo-exam0',
    before: null, after: { resultsPublished: 236, notified: 472 },
  },
  {
    // The masked case: a phone number that CHANGED, so the redaction is
    // visible rather than merely claimed. The server masks to the last two
    // digits — enough to recognise a number, not enough to dial it.
    id: '1b', at: '2026-08-24T17:10:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'ops.user.create', entityType: 'user', entityId: 'demo-new-user',
    before: null, after: { nameBn: 'নতুন শিক্ষক', roleCode: 'subject_teacher', phone: '•••47' },
  },
  {
    id: '1', at: '2026-08-24T16:00:00Z',
    actor: { id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
    action: 'ops.settings.update', entityType: 'tenant', entityId: 'demo-tenant',
    before: { noticeMaxChars: 180 }, after: { noticeMaxChars: 240 },
  },
];

/** Mutable so the preview's fee-permission toggle actually holds. */
let demoGuardianPays = true;

/**
 * R-4's calendar fixture.
 *
 * Two tenants with DIFFERENT weekends, because that is the property the
 * feature exists to have: tenant A runs Fri+Sat, tenant B (a Madrasah) runs
 * Friday only, and the grid must shade whatever it is told rather than a
 * hardcoded pair of days.
 */
const DEMO_CALENDAR: Record<'a' | 'b', {
  weekendDays: number[];
  entries: {
    id: string; day: string; kind: string; titleBn: string;
    descriptionBn: string | null; appliesToShifts: string[] | null;
    source: string; editable: boolean; createdByNameBn?: string | null;
  }[];
}> = {
  a: {
    weekendDays: [5, 6],
    entries: [
      { id: 'demo-cal-1', day: '2026-10-10', kind: 'holiday', titleBn: 'বিদ্যালয় ছুটি',
        descriptionBn: 'দুর্গাপূজা উপলক্ষে বিদ্যালয় বন্ধ থাকবে।', appliesToShifts: null,
        source: 'calendar', editable: true, createdByNameBn: 'প্রধান শিক্ষক' },
      { id: 'demo-cal-2', day: '2026-10-15', kind: 'event', titleBn: 'ক্রীড়া দিবস',
        descriptionBn: 'সকাল ৯টায় মাঠে।', appliesToShifts: null,
        source: 'calendar', editable: true, createdByNameBn: 'প্রধান শিক্ষক' },
      // R-4.1. 2026-10-17 is a Saturday — inside tenant A's {5,6} weekend —
      // declared a working day. The one date the column says shut and the
      // school says open.
      { id: 'demo-cal-4', day: '2026-10-17', kind: 'working_weekend',
        titleBn: 'বন্যার ক্ষতি পুষিয়ে নিতে ক্লাস',
        descriptionBn: 'শনিবার স্বাভাবিক রুটিনে ক্লাস হবে।', appliesToShifts: null,
        source: 'calendar', editable: true, createdByNameBn: 'প্রধান শিক্ষক' },
      { id: 'demo-cal-3', day: '2026-10-15', kind: 'event', titleBn: 'অভিভাবক সভা',
        descriptionBn: null, appliesToShifts: ['morning'],
        source: 'calendar', editable: true, createdByNameBn: 'প্রধান শিক্ষক' },
      // Read from the exam tables, not stored here — hence editable: false.
      { id: 'exam:demo-exam1', day: '2026-10-20', kind: 'exam',
        titleBn: 'অর্ধবার্ষিক পরীক্ষা', descriptionBn: '2026-10-20 — 2026-10-28',
        appliesToShifts: null, source: 'exam', editable: false },
      { id: 'exam-subject:demo-es1', day: '2026-10-21', kind: 'exam',
        titleBn: 'অর্ধবার্ষিক পরীক্ষা — পদার্থবিজ্ঞান',
        descriptionBn: 'নবম শ্রেণি · সেকশন F', appliesToShifts: null,
        source: 'exam', editable: false },
    ],
  },
  b: {
    // Friday only. Different school, different week.
    weekendDays: [5],
    entries: [
      { id: 'demo-cal-b1', day: '2026-10-12', kind: 'holiday', titleBn: 'ঈদে মিলাদুন্নবী',
        descriptionBn: null, appliesToShifts: null,
        source: 'calendar', editable: true, createdByNameBn: 'অধ্যক্ষ' },
    ],
  },
};

/**
 * R-6's student directory, answered locally.
 *
 * Twelve children, four academic years, and one of them — রাফি হাসান,
 * STU-8F39A271 — is the master plan's own worked example, carried verbatim
 * so the acceptance walk in the R-6 log can be repeated by anyone with the
 * preview link. He moves class, section and roll every year and graduates,
 * which is the case that breaks a timeline built from the current enrolment.
 */
interface DemoStudent {
  id: string;
  nameBn: string;
  nameEn: string;
  code: string;
  status: string;
  /** The section this child sits in TODAY, used for the teacher scope. */
  sectionId: string;
  guardianPhone: string;
  phone: string;
  years: { year: string; classBn: string; group: string; section: string; roll: number }[];
}

const DEMO_CLASSES = ['সপ্তম শ্রেণি', 'অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি'];

const DEMO_STUDENTS: DemoStudent[] = NAMES.map(([bn, en], i) => {
  // Deterministic, so the same id always renders the same child and two
  // screenshots of "STU-8F39A271" are comparable.
  const code = i === 10 ? 'STU-8F39A271' : `STU-${(0x1000_0000 + i * 0x2F41B7).toString(16).toUpperCase().slice(0, 8)}`;
  // The worked example is carried verbatim — name AND code — so anyone can
  // repeat the acceptance walk from the master plan's own text.
  const isExample = i === 10;
  const graduated = isExample || i % 5 === 0;
  return {
    id: `demo-stu-${i + 1}`,
    nameBn: isExample ? 'রাফি হাসান' : bn,
    nameEn: isExample ? 'Rafi Hasan' : en,
    code,
    status: graduated ? 'graduated' : 'enrolled',
    sectionId: i % 2 === 0 ? 'demo-9a' : 'demo-9b',
    guardianPhone: `+88017${String(11000000 + i).padStart(8, '0')}`,
    phone: `+88018${String(11000000 + i).padStart(8, '0')}`,
    years: DEMO_CLASSES.map((classBn, y) => ({
      year: String(2024 + y),
      classBn,
      group: y >= 2 ? 'বিজ্ঞান' : 'সাধারণ',
      // The section and the roll MOVE. A fixture where they did not would
      // let a broken timeline look correct.
      section: ['ক', 'খ', 'গ', 'ঘ'][(i + y) % 4],
      roll: 1 + ((i * 7 + y * 13) % 40),
    })),
  };
});

/** The demo's own `app.can_see_student`, with the same four answers. */
function demoCanSee(s: DemoStudent): boolean {
  switch (demoRole()) {
    case 'student':  return s.id === 'demo-stu-11';       // the signed-in child
    case 'guardian': return s.id === 'demo-stu-11' || s.id === 'demo-stu-4';
    case 'class_teacher':
    case 'subject_teacher': return s.sectionId === 'demo-9a';
    default: return true;                                  // management
  }
}

function demoStudentSearch(q: URLSearchParams): Response {
  const text = (q.get('q') ?? '').trim();
  const status = (q.get('status') ?? '').trim();
  const offset = Math.max(Number(q.get('offset')) || 0, 0);
  const limit = 25;

  if (!text && !status) {
    return new Response(
      JSON.stringify({ error: 'query_too_short', message: 'অনুসন্ধানের জন্য অন্তত ২টি অক্ষর লিখুন।' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (text && text.length < 2) {
    return new Response(
      JSON.stringify({ error: 'query_too_short', message: 'অনুসন্ধানের জন্য অন্তত ২টি অক্ষর লিখুন।' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const needle = text.toLowerCase();
  const hits = DEMO_STUDENTS.filter((s) => {
    if (!demoCanSee(s)) return false;
    if (status && s.status !== status) return false;
    if (!text) return true;
    // The digits must be checked for emptiness first. `'সুমাইয়া'.replace(
    // /[^\d]/g,'')` is '', and `String.includes('')` is true for every
    // string — so the phone branch matched the whole school on any Bangla
    // query. Caught in the browser, and worth recording: the real endpoint
    // cannot have this bug because it classifies the query shape and only
    // ever runs ONE branch, which is the reason it does that.
    const digits = text.replace(/[^\d]/g, '');
    return s.code.toLowerCase().includes(needle)
      || s.nameBn.includes(text)
      || s.nameEn.toLowerCase().includes(needle)
      || (digits.length >= 4
          && (s.phone.includes(digits) || s.guardianPhone.includes(digits)));
  });

  const page = hits.slice(offset, offset + limit);
  return ok({
    total: hits.length, limit, offset,
    matchedOn: /^stu-/i.test(text) ? 'code' : 'name',
    students: page.map((s) => {
      const last = s.years[s.years.length - 1];
      return {
        id: s.id,
        name: { bn: s.nameBn, en: s.nameEn },
        studentCode: s.code,
        lifecycleStatus: s.status,
        latest: {
          yearLabel: last.year, classBn: last.classBn, groupBn: last.group,
          section: last.section, rollNo: last.roll,
          // A graduate has no current enrolment, which is what puts the year
          // in front of their row in the result list.
          isCurrent: s.status !== 'graduated',
        },
      };
    }),
  });
}

function demoStudentHistory(q: URLSearchParams): Response {
  const id = q.get('studentId') ?? '';
  const s = DEMO_STUDENTS.find((x) => x.id === id);
  // Invisible and absent give the same answer here too.
  if (!s || !demoCanSee(s)) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'শিক্ষার্থী পাওয়া যায়নি' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const role = demoRole();
  const maySeeFees = ['principal', 'school_owner', 'accountant', 'guardian', 'student'].includes(role);
  const maySeeContact = ['principal', 'school_owner', 'academic_coordinator', 'it_admin',
                         'class_teacher', 'accountant', 'guardian', 'student'].includes(role);
  const printable = Object.entries(DOC_ACCESS)
    .filter(([k, roles]) => k !== 'attendance_sheet' && roles.includes(role))
    .map(([k]) => k);

  return ok({
    student: {
      id: s.id,
      name: { bn: s.nameBn, en: s.nameEn },
      studentCode: s.code,
      lifecycleStatus: s.status,
      admissionDate: '2024-01-05',
      graduatedOn: s.status === 'graduated' ? '2027-02-28' : null,
      bloodGroup: maySeeContact ? 'B+' : null,
      fatherNameBn: maySeeContact ? 'মোঃ আব্দুর রহিম' : null,
      motherNameBn: maySeeContact ? 'রোকসানা বেগম' : null,
      dateOfBirth: maySeeContact ? '2010-03-14' : null,
      phone: maySeeContact ? s.phone : null,
      boardRegistrationNo: maySeeContact ? 'BR-0000042' : null,
      boardRollNo: maySeeContact ? 'BRN-000042' : null,
    },
    enrolments: s.years.map((y, i) => ({
      yearLabel: y.year,
      classBn: y.classBn, classEn: `Class ${7 + i}`, levelNo: 7 + i,
      groupBn: y.group, section: y.section, shift: 'morning',
      rollNo: y.roll,
      status: i === s.years.length - 1 && s.status !== 'graduated' ? 'active' : 'promoted',
      enrolledOn: `${y.year}-01-05`,
      endedOn: i === s.years.length - 1 && s.status !== 'graduated' ? null : `${y.year}-12-20`,
      isCurrent: i === s.years.length - 1 && s.status !== 'graduated',
    })),
    attendance: s.years.map((y, i) => {
      const total = 200 - i * 3;
      const absent = 6 + i;
      const late = 3 + (i % 3);
      const excused = 2;
      const present = total - absent - late - excused;
      return {
        yearLabel: y.year, present, absent, late, excused, halfDay: 0, total,
        percent: Math.round(((present + late) / total) * 1000) / 10,
      };
    }),
    results: s.years.map((y) => ({
      yearLabel: y.year,
      examBn: 'বার্ষিক পরীক্ষা',
      totalMarks: String(380 + (y.roll % 90)),
      totalMax: '500',
      percentage: String(Math.round(((380 + (y.roll % 90)) / 5) * 100) / 100),
      gpa: (3 + (y.roll % 20) / 20).toFixed(2),
      letterGrade: 'A',
      isPass: true,
      rankInSection: y.roll,
    })),
    fees: maySeeFees ? {
      years: s.years.map((y) => ({
        yearLabel: y.year, invoices: 12,
        billed: '14400.00', paid: y.year === '2027' ? '13200.00' : '14400.00',
        due: y.year === '2027' ? '1200.00' : '0.00',
      })),
      receipts: [
        { id: 'demo-rcp-1', receiptNo: 'RCP-2026-00042', issuedAt: '2026-05-12T09:15:00Z',
          amount: '1300.00', method: 'bkash', invoiceNo: 'INV-2026-05-00042' },
        { id: 'demo-rcp-2', receiptNo: 'RCP-2026-00031', issuedAt: '2026-04-11T10:02:00Z',
          amount: '1200.00', method: 'cash', invoiceNo: 'INV-2026-04-00031' },
      ],
    } : null,
    documents: printable.filter((t) => t !== 'transfer_certificate'),
    certificates: printable.filter((t) => t === 'transfer_certificate'),
    permissions: { fees: maySeeFees, contact: maySeeContact },
  });
}

/**
 * R-5's document endpoint, answered locally.
 *
 * `DOC_ACCESS` mirrors `services/ops-svc/api/document.ts` deliberately: a
 * demo that let a guardian print a transfer certificate would teach the
 * wrong thing about the product. The two lists are duplicated rather than
 * shared because the server's copy must not be reachable from the browser
 * bundle; if they drift, the browser acceptance in the R-5 log is what
 * catches it.
 */
const DOC_ACCESS: Record<string, string[]> = {
  fee_receipt: ['principal', 'school_owner', 'accountant', 'student', 'guardian'],
  report_card: ['principal', 'school_owner', 'academic_coordinator', 'dept_head',
                'class_teacher', 'subject_teacher', 'student', 'guardian'],
  admit_card: ['principal', 'school_owner', 'academic_coordinator', 'dept_head',
               'class_teacher', 'subject_teacher', 'student', 'guardian'],
  id_card: ['principal', 'school_owner', 'academic_coordinator', 'it_admin', 'class_teacher'],
  transfer_certificate: ['principal', 'school_owner'],
  attendance_sheet: ['principal', 'school_owner', 'academic_coordinator',
                     'dept_head', 'class_teacher', 'subject_teacher'],
};

/**
 * The children a family account reaches, by the ids the family screens use:
 * the student preview is Rafi (`demo-user`, and `demo-s1` on the ward and
 * results feeds), and the guardian's two wards are DEMO_WARDS.
 * `app.can_see_student` for a family is this list and nothing wider.
 */
const DEMO_FAMILY_IDS: Record<string, string[]> = {
  student: ['demo-user', 'demo-s1'],
  guardian: ['demo-s1', 'demo-s2'],
};
const DEMO_RAFI_IDS = new Set(['demo-user', 'demo-s1']);

/** A family's child as their printed documents name them — the ward list's names. */
function demoFamilyRef(studentId: string): StudentRef | null {
  if (!Object.values(DEMO_FAMILY_IDS).some((ids) => ids.includes(studentId))) return null;
  const rafi = DEMO_RAFI_IDS.has(studentId);
  const ward = DEMO_WARDS.find((w) => w.studentId === (rafi ? 'demo-s1' : studentId))!;
  return {
    nameBn: ward.nameBn, nameEn: rafi ? 'Rafir Hasan' : 'Tahiya Hasan',
    studentCode: rafi ? 'STU-8F39A271' : 'STU-5C21D904',
    classBn: rafi ? 'নবম শ্রেণি' : 'পঞ্চম শ্রেণি',
    groupBn: rafi ? 'বিজ্ঞান' : null,
    section: rafi ? 'ক' : 'খ',
    rollNo: ward.rollNo,
    fatherNameBn: 'মোঃ কামরুল হাসান',
    motherNameBn: 'নাসরিন সুলতানা',
    dateOfBirth: rafi ? '2011-02-19' : '2015-06-08',
    admissionDate: rafi ? '2019-01-06' : '2021-01-05',
    bloodGroup: rafi ? 'O+' : 'A+',
  };
}

/**
 * The exams a document may name, from the feeds that offer them: the results
 * a family reads, the publish list the office reads, and the exam register.
 */
function demoExamFor(examId: string): { id: string; nameBn: string; published: boolean } | null {
  const result = DEMO_RESULTS.find((r) => r.examId === examId);
  if (result) return { id: examId, nameBn: result.examNameBn, published: true };
  const office: Record<string, { nameBn: string; published: boolean }> = {
    'demo-exam0': { nameBn: 'প্রথম সাময়িক পরীক্ষা', published: true },
    'demo-exam1': { nameBn: 'অর্ধবার্ষিক পরীক্ষা', published: false },
  };
  if (office[examId]) return { id: examId, ...office[examId] };
  const reg = DEMO_EXAM_REGISTER.find((e) => e.id === examId);
  return reg ? { id: examId, nameBn: reg.nameBn, published: reg.status === 'published' } : null;
}

function demoStudentRef(studentId: string): StudentRef {
  // A family's own child keeps the name their guardian panel shows.
  if (['student', 'guardian'].includes(demoRole())) {
    const family = demoFamilyRef(studentId);
    if (family) return family;
  }
  // Ids look like `demo-9a-s7`; the trailing number picks a name so the same
  // id always renders the same child, which matters when someone prints a
  // card twice and compares them.
  const n = Number(studentId.match(/-s(\d+)$/)?.[1] ?? '1');
  const [bn, en] = NAMES[(n - 1) % NAMES.length];
  const sec = studentId.startsWith('demo-10a') ? 'ক' : studentId.includes('-9b-') ? 'খ' : 'ক';
  return {
    nameBn: bn, nameEn: en,
    studentCode: `2024-${String(1000 + n).slice(1)}`,
    classBn: studentId.startsWith('demo-10a') ? 'দশম শ্রেণি' : 'নবম শ্রেণি',
    groupBn: 'বিজ্ঞান',
    section: sec,
    rollNo: n,
    fatherNameBn: 'মোঃ আব্দুর রহিম',
    motherNameBn: 'রোকসানা বেগম',
    dateOfBirth: '2010-03-14',
    admissionDate: '2024-01-05',
    bloodGroup: ['A+', 'B+', 'O+', 'AB+'][n % 4],
  };
}

/** `routine_sheet` in ACCESS: everybody has a routine, so everybody may print one. */
const ROUTINE_SHEET_ROLES = ['principal', 'school_owner', 'academic_coordinator', 'it_admin',
  'dept_head', 'class_teacher', 'subject_teacher', 'student', 'guardian'];

/**
 * The printed routine (P9-9), drawn from the SAME grid the timetable screen
 * reads. It had no case, so ছাপুন on a published routine said "অজানা নথি" and
 * could never print.
 */
function demoRoutineSheet(q: URLSearchParams): Response {
  const role = demoRole();
  if (!ROUTINE_SHEET_ROLES.includes(role)) {
    return refuse(403, 'forbidden', 'এই নথি তৈরির অনুমতি আপনার নেই');
  }
  const known: RoutineScope[] = ['institution', 'class', 'group', 'stream',
    'section', 'teacher', 'room', 'student'];
  const scope = (q.get('scope') ?? '') as RoutineScope;
  if (!known.includes(scope)) {
    return refuse(400, 'invalid_scope', `scope must be one of: ${known.join(', ')}`);
  }
  const admin = ['principal', 'school_owner', 'academic_coordinator', 'it_admin'].includes(role);
  if (!admin && ['institution', 'class', 'group', 'stream', 'room'].includes(scope)) {
    return refuse(403, 'forbidden_scope', 'এই রুটিন দেখার অনুমতি আপনার নেই।', { scope });
  }
  const board = q.get('board') === '1';
  const t = demoTimetable(role, scope);
  const r = t.routines[0];
  const lessons = t.lessons.map((l) => ({ ...l, classLevel: 9 }));
  // A booklet scope prints one page per class; the demo teaches one class.
  const booklet = ['institution', 'group', 'stream', 'class'].includes(scope);
  const locale: 'bn' | 'en' = q.get('locale') === 'en' ? 'en' : 'bn';
  const sections = [buildRoutineSheet({
    scopeTitle: booklet ? 'নবম শ্রেণি' : t.titleBn,
    scopeKind: booklet ? 'class' : scope,
    yearLabel: r.yearLabel, shiftBn: r.shiftBn, version: r.version, publishedAt: r.publishedAt,
    days: t.days,
    periods: t.periods.map(({ routineId: _r, ...p }) => p),
    lessons, board,
  }, locale)];
  const html = brandedDocumentSet({
    branding: parseBranding(DEMO_TENANTS[demoTenantKey()].branding),
    sections, locale,
    extraCss: documentBodyCss() + routineSheetCss(routineOrientation(scope), board),
  });
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' },
  });
}

function demoDocument(q: URLSearchParams): Response {
  const type = q.get('type') ?? '';
  if (type === 'routine_sheet') return demoRoutineSheet(q);
  const allowed = DOC_ACCESS[type];
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'bad_type', message: 'অজানা নথি' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!allowed.includes(demoRole())) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'এই নথি তৈরির অনুমতি আপনার নেই' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const explicit = (q.get('studentIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const one = (q.get('studentId') ?? '').trim();
  const sectionId = (q.get('sectionId') ?? '').trim();
  const asked = explicit.length ? explicit
    : one ? [one]
    : sectionId ? NAMES.map((_, i) => `${sectionId}-s${i + 1}`)
    : [];
  // Finding 13. A student or guardian prints their OWN child's card, and RLS
  // is what keeps it that way: a child they cannot see is simply not loaded,
  // which is the same answer as a child who does not exist.
  const family = DEMO_FAMILY_IDS[demoRole()];
  const ids = family ? asked.filter((id) => family.includes(id)) : asked;

  // reportCards / admitCards: both name one exam, and a report card only
  // once its results are published.
  let exam: ReturnType<typeof demoExamFor> = null;
  if (type === 'report_card' || type === 'admit_card') {
    const examId = (q.get('examId') ?? '').trim();
    if (!examId) return refuse(400, 'bad_request', 'examId is required', { field: 'examId' });
    exam = demoExamFor(examId);
    if (!exam) return refuse(404, 'not_found', 'পরীক্ষা পাওয়া যায়নি');
    if (type === 'report_card' && !exam.published) {
      return refuse(409, 'not_published', 'এই পরীক্ষার ফলাফল এখনো প্রকাশিত হয়নি — আগে প্রকাশ করুন');
    }
  }

  const locale: 'bn' | 'en' = q.get('locale') === 'en' ? 'en' : 'bn';
  const branding = parseBranding(DEMO_TENANTS[demoTenantKey()].branding);
  const sections = demoSectionsFor(type, ids, sectionId, locale, exam);
  if (sections.length === 0) {
    return new Response(
      JSON.stringify({ error: 'no_data', message: 'নথির জন্য কোনো তথ্য পাওয়া যায়নি' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const html = brandedDocumentSet({
    branding, sections, locale, extraCss: documentBodyCss(),
  });
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' },
  });
}

function demoSectionsFor(
  type: string, ids: string[], sectionId: string, locale: 'bn' | 'en',
  exam: ReturnType<typeof demoExamFor> = null,
): BrandedSection[] {
  const students = ids.map(demoStudentRef);
  switch (type) {
    case 'fee_receipt': {
      const s = students[0] ?? demoStudentRef('demo-9a-s1');
      return [buildFeeReceipt({
        student: s,
        receiptNo: 'RCP-2026-00042',
        issuedAt: '2026-05-12T09:15:00Z',
        amount: '1300.00', method: 'bkash',
        invoiceNo: 'INV-2026-05-00042', billingPeriod: '2026-05',
        lines: [
          { descriptionBn: 'মাসিক বেতন', amount: '1200.00', waiver: '200.00' },
          { descriptionBn: 'পরীক্ষার ফি', amount: '300.00', waiver: '0.00' },
        ],
        invoiceTotal: '1300.00', paidToDate: '1300.00', balance: '0.00',
      }, locale)];
    }
    case 'report_card':
      return students.map((s, i) => {
        // A family's card is the mark sheet ফলাফল shows for that exam — the
        // same subjects, totals, GPA and rank — so the printout and the
        // screen cannot disagree. A child with no result for it gets the
        // card with no marks, as the service's LEFT JOIN gives.
        if (DEMO_FAMILY_IDS[demoRole()]) {
          const r = DEMO_RAFI_IDS.has(ids[i]) ? DEMO_RESULTS.find((x) => x.examId === exam?.id) : undefined;
          return buildReportCard({
            student: s,
            examNameBn: exam?.nameBn ?? '', yearLabel: '২০২৬',
            subjects: (r?.subjects ?? []).map((sub) => ({
              nameBn: sub.subjectBn, obtained: sub.totalMarks, max: '100',
              grade: sub.gradeLetter, gradePoint: sub.gradePoint, isAbsent: sub.isAbsent,
            })),
            totalMarks: r?.totalMarks ?? null, totalMax: r?.totalMax ?? null,
            percentage: r?.percentage ?? null, gpa: r?.gpa ?? null,
            letterGrade: r?.letterGrade ?? null, isPass: r?.isPass ?? false,
            rankInSection: r?.rankInSection ?? null,
            attendancePercent: r ? String(DEMO_ATTENDANCE.totals.attendedPercent.toFixed(2)) : null,
          }, locale);
        }
        return buildReportCard({
        student: s,
        examNameBn: exam?.nameBn ?? 'অর্ধবার্ষিক পরীক্ষা', yearLabel: '২০২৬',
        subjects: [
          { nameBn: 'বাংলা', obtained: '72', max: '100', grade: 'A-', gradePoint: '3.50', isAbsent: false },
          { nameBn: 'ইংরেজি', obtained: '68', max: '100', grade: 'B', gradePoint: '3.00', isAbsent: false },
          { nameBn: 'গণিত', obtained: '81', max: '100', grade: 'A', gradePoint: '4.00', isAbsent: false },
          { nameBn: 'পদার্থবিজ্ঞান', obtained: null, max: '100', grade: null, gradePoint: null, isAbsent: true },
        ],
        totalMarks: '221', totalMax: '400', percentage: '55.25', gpa: '3.50',
        letterGrade: 'A-', isPass: true, rankInSection: s.rollNo ?? null,
        attendancePercent: '94.50',
      }, locale);
      });
    case 'admit_card':
      return students.map((s) => buildAdmitCard({
        student: s,
        examNameBn: exam?.nameBn ?? 'বার্ষিক পরীক্ষা', yearLabel: '২০২৬',
        papers: [
          { subjectBn: 'বাংলা', examDate: '2026-11-02', startTime: '10:00', hallBn: 'হল ১', seat: 'সারি ২, আসন ৪' },
          { subjectBn: 'ইংরেজি', examDate: '2026-11-04', startTime: '10:00', hallBn: 'হল ১', seat: 'সারি ২, আসন ৪' },
          { subjectBn: 'গণিত', examDate: '2026-11-06', startTime: '10:00', hallBn: null, seat: null },
        ],
        instructionsBn: ADMIT_INSTRUCTIONS_BN,
      }, locale));
    case 'id_card':
      return students.map((s) => buildIdCard({
        student: s, yearLabel: '২০২৬', validUntil: '2026-12-31',
        guardianPhone: '+8801711000010',
      }, locale));
    case 'transfer_certificate': {
      const s = students[0] ?? demoStudentRef('demo-9a-s1');
      return [buildTransferCertificate({
        student: s,
        certificateNo: `TC-2026-${s.studentCode ?? '0001'}`,
        issuedOn: '2026-07-01',
        lastClassBn: s.classBn ?? 'নবম শ্রেণি', lastYearLabel: '২০২৬',
        admissionDate: s.admissionDate ?? null, leftOn: '2026-06-30',
        conductBn: 'সন্তোষজনক',
        reasonBn: 'অভিভাবকের বদলিজনিত কারণে।',
        duesCleared: true,
      }, locale)];
    }
    case 'attendance_sheet':
      return [buildAttendanceSheet({
        classBn: sectionId.startsWith('demo-10a') ? 'দশম শ্রেণি' : 'নবম শ্রেণি',
        groupBn: 'বিজ্ঞান',
        section: sectionId.includes('-9b') ? 'খ' : 'ক',
        yearLabel: '২০২৬',
        monthBn: 'মে ২০২৬',
        students: NAMES.map(([bn], i) => ({ rollNo: i + 1, nameBn: bn })),
        dayColumns: 31,
      }, locale)];
    default:
      return [];
  }
}

// ═════════════════════════════════════════════════════════════════════════
// UX sweep, group "demo". Every endpoint below either fell through to the
// 404 default — so a screen in a role's own sidebar opened on "আনা যায়নি"
// and its retry could never help — or answered a write with a read's shape.
//
// The rule each one follows is the rest of this file's: answer the SHAPE the
// service answers, refuse what the service refuses, and where a write has a
// visible effect, hold it for the life of the page so the screen's reload
// shows it. Nothing is persisted and nothing leaves the device.
// ═════════════════════════════════════════════════════════════════════════

// ── Notices (findings 0, 3, 5, 11) ──────────────────────────────────────

/** AUTHOR_ROLES and SCHOOL_WIDE_ROLES in services/ops-svc/api/notices.ts. */
const NOTICE_AUTHOR_ROLES = ['principal', 'school_owner', 'academic_coordinator', 'class_teacher'];
const NOTICE_SCHOOL_WIDE_ROLES = ['principal', 'school_owner', 'academic_coordinator'];
/** SMS_CONFIRM_THRESHOLD in ops-svc: above this many messages, a second act. */
const DEMO_SMS_CONFIRM_THRESHOLD = 200;
/** The demo school's SMS cap — the figure `/ops/settings` answers. */
const DEMO_NOTICE_MAX_CHARS = 180;

/**
 * Who each school-wide audience reaches, and how many of them would be TEXTED
 * (a phone on file, and consent for a guardian) — the two numbers the
 * composer's estimate is made of.
 *
 * 1,240 students is the dashboard's figure, so the composer and the head
 * teacher's home describe one school. Guardians are fewer than students
 * (siblings share one) and texting reaches fewer again. "সব অভিভাবক" with SMS
 * on crosses the 200 gate, so the irreversible panel is reachable in the
 * preview; one section never does.
 */
const DEMO_NOTICE_REACH: Record<string, { recipients: number; sms: number }> = {
  students:         { recipients: 1240, sms: 312 },
  guardians:        { recipients: 1186, sms: 1094 },
  guardians_payers: { recipients: 1102, sms: 1031 },
  staff:            { recipients: 56, sms: 56 },
  all:              { recipients: 1240 + 1186 + 56, sms: 312 + 1094 + 56 },
};

function demoNoticeReach(audience: unknown): { recipients: number; sms: number } {
  const a = (audience ?? { type: 'all' }) as { type?: unknown; ids?: unknown };
  const type = typeof a.type === 'string' ? a.type : 'all';
  const ids = Array.isArray(a.ids) ? [...new Set(a.ids.map(String))] : [];
  if (type === 'users') return { recipients: ids.length, sms: ids.length };
  if (type === 'section') {
    // Every child and their guardian. The demo roster holds no student
    // phones, so only guardians are texted — less one without consent.
    return ids.reduce((sum, id) => {
      const s = SECTIONS.find((x) => x.id === id);
      return s
        ? { recipients: sum.recipients + s.studentCount * 2,
            sms: sum.sms + Math.max(0, s.studentCount - 1) }
        : sum;
    }, { recipients: 0, sms: 0 });
  }
  return DEMO_NOTICE_REACH[type] ?? { recipients: 0, sms: 0 };
}

/**
 * `noticeSmsBody` from services/sms-svc/src/dispatch.ts, copied because that
 * module imports node:crypto. The estimate counts the message that would be
 * SENT — title, trimmed body, the school's name — so the segments have to
 * come from the same construction or every figure is short.
 */
function demoNoticeSmsBody(title: string, body: string, org: string, maxChars: number): string {
  const head = title.trim();
  const rest = body.trim().replace(/\s+/g, ' ');
  const room = maxChars - head.length - org.length - 6;
  const tail = room > 20 && rest.length > 0
    ? (rest.length <= room ? rest : `${rest.slice(0, room - 1)}…`)
    : '';
  return tail ? `${head}: ${tail} — ${org}` : `${head} — ${org}`;
}

/** Notices written in this preview, as the author list returns them. */
const demoSentNotices: Array<{
  id: string; title: string; body: string; category: string; audience: unknown;
  send_sms: boolean; status: string; published_at: string | null;
  recipient_count: number; created_at: string;
}> = [];

/**
 * POST /ops/notices?preview=1 is a different question from POST /ops/notices,
 * and the demo answered both with the publish reply. That reply has no
 * segmentsEach, segmentsTotal or needsConfirmation, so the composer threw on
 * the first estimate, the send button never enabled, and a pause while
 * typing the message wiped the form (findings 0, 3, 5, 11).
 */
function demoNotices(url: URL, init: RequestInit): Response {
  if (methodOf(init) === 'GET') return ok({ notices: [...demoSentNotices].reverse() });
  if (methodOf(init) !== 'POST') return ok({ error: 'method_not_allowed' }, 405);
  const role = demoRole();
  if (!NOTICE_AUTHOR_ROLES.includes(role)) {
    return refuse(403, 'forbidden', `this endpoint requires one of: ${NOTICE_AUTHOR_ROLES.join(', ')}`);
  }

  if (url.searchParams.get('preview') === '1') {
    const b = bodyOf<{ audience: unknown; body: unknown; title: unknown; sendSms: unknown }>(init);
    const text = typeof b.body === 'string' ? b.body : '';
    const title = typeof b.title === 'string' ? b.title : '';
    const org = DEMO_TENANTS[demoTenantKey()].branding.nameBn;
    const segmentsEach = smsSegmentsFor(demoNoticeSmsBody(title, text, org, DEMO_NOTICE_MAX_CHARS));
    const reach = demoNoticeReach(b.audience);
    const smsRecipients = b.sendSms === true ? reach.sms : 0;
    const segmentsTotal = smsRecipients * segmentsEach;
    return ok({
      recipients: reach.recipients,
      smsRecipients,
      segmentsEach,
      segmentsTotal,
      confirmThreshold: DEMO_SMS_CONFIRM_THRESHOLD,
      needsConfirmation: segmentsTotal > DEMO_SMS_CONFIRM_THRESHOLD,
    });
  }

  const b = bodyOf<{ notice: unknown; publish: boolean; publishAt: string | null }>(init);
  let draft: NoticeDraft;
  try {
    draft = parseNotice(b.notice);
  } catch (err) {
    if (err instanceof NoticeError) return refuse(400, 'invalid_notice', err.message, { field: err.field });
    throw err;
  }
  if (!NOTICE_SCHOOL_WIDE_ROLES.includes(role) && draft.audience.type !== 'section') {
    return refuse(403, 'audience_not_permitted',
      'a class teacher may publish to their own sections only', { field: 'audience' });
  }

  const at = b.publishAt ? Date.parse(b.publishAt) : NaN;
  const status = b.publish === false ? 'draft'
    : Number.isFinite(at) && at > Date.now() ? 'scheduled' : 'published';
  const reach = demoNoticeReach(draft.audience);
  if (status === 'published' && reach.recipients === 0) {
    return refuse(400, 'invalid_audience', 'that audience selects nobody');
  }
  const now = new Date().toISOString();
  const noticeId = `demo-notice-${demoSentNotices.length + 1}`;
  demoSentNotices.push({
    id: noticeId, title: draft.title, body: draft.body, category: draft.category,
    audience: draft.audience, send_sms: draft.sendSms, status,
    published_at: status === 'published' ? now : null,
    recipient_count: status === 'published' ? reach.recipients : 0,
    created_at: now,
  });
  if (status === 'draft') return ok({ noticeId, status, recipients: 0, smsQueued: false }, 201);
  if (status === 'scheduled') {
    return ok({ noticeId, status, recipients: 0, smsQueued: false,
                publishAt: new Date(at).toISOString() }, 201);
  }
  return ok({ noticeId, status, recipients: reach.recipients, smsQueued: draft.sendSms }, 201);
}

// ── Homework grading (finding 10) ───────────────────────────────────────

/**
 * Marks given in this preview, by submission id. The grading POST used to
 * be answered with the assignment LIST — 200 with no `ok` — so every mark a
 * teacher gave read "সংরক্ষণ করা যায়নি।". Held for the life of the page so the
 * reload after a save shows the row graded.
 */
const demoGrades = new Map<string, {
  marksAwarded: string; feedbackBn: string | null; gradedAt: string;
  rowVersion: number; gradedByName: string;
}>();

interface DemoSubmission {
  id: string; studentId: string; fullNameBn: string; rollNo: number; bodyBn: string;
  submittedAt: string; isLate: boolean; marksAwarded: string | null;
  feedbackBn: string | null; gradedAt: string | null; gradedByName: string | null;
  rowVersion: number;
}

/**
 * Each assignment's own submissions. They used to share three ids, so a mark
 * given on one homework would have appeared on the other.
 */
function demoSubmissionsFor(assignmentId: string): DemoSubmission[] {
  const sub = (
    id: string, studentId: string, fullNameBn: string, rollNo: number, bodyBn: string,
    submittedAt: string, isLate = false,
  ): DemoSubmission => ({
    id, studentId, fullNameBn, rollNo, bodyBn, submittedAt, isLate,
    marksAwarded: null, feedbackBn: null, gradedAt: null, gradedByName: null, rowVersion: 1,
  });
  const base: DemoSubmission[] = assignmentId === 'demo-a-3'
    ? [{
        ...sub('demo-sub-me', 'demo-user', 'রাফি', 7,
          'বিজ্ঞান ও প্রযুক্তি আমাদের জীবনযাত্রাকে সহজ করেছে…', inDays(-4)),
        marksAwarded: '13.00', feedbackBn: 'ভালো লিখেছ — উপসংহারটি আরও শক্ত হতে পারত।',
        gradedAt: inDays(-2), gradedByName: 'নাজমা সুলতানা', rowVersion: 2,
      }]
    : assignmentId === 'demo-a-2'
      ? [
          sub('demo-sub-a2-1', 'demo-s4', 'নুসরাত জাহান', 4,
            'x² − 5x + 6 = (x − 2)(x − 3); বাকি নয়টি একই নিয়মে…', inDays(-2)),
          sub('demo-sub-a2-7', 'demo-user', 'রাফি', 7,
            '১) a² − b² = (a + b)(a − b)  ২) x² + 7x + 12 = (x + 3)(x + 4) …', inDays(-1)),
        ]
      : [
          sub('demo-sub-1', 'demo-s1', 'আয়শা সিদ্দিকা', 1,
            'a = (v − u)/t সূত্র ব্যবহার করে… ক) ৪ m/s²  খ) ২০ মিটার', inDays(-1)),
          sub('demo-sub-2', 'demo-s2', 'তানভীর হাসান', 2,
            'প্রথমে u = ১০, v = ৩০, t = ৫ ধরে…', inDays(-1)),
          sub('demo-sub-3', 'demo-s3', 'নুসরাত জাহান', 3, 'সমাধান সংযুক্ত করা হলো।', inDays(0), true),
        ];
  return base.map((s) => {
    const g = demoGrades.get(s.id);
    return g ? { ...s, ...g } : s;
  });
}

/** The row a family may see: their own, as `assignment_read_scope` allows. */
function demoSubmissionsVisible(assignmentId: string): DemoSubmission[] {
  const all = demoSubmissionsFor(assignmentId);
  return ['student', 'guardian'].includes(demoRole())
    ? all.filter((s) => s.studentId === 'demo-user')
    : all;
}

function demoAssignmentList(): unknown {
  return {
    assignments: DEMO_ASSIGNMENTS.map((a) => {
      const graded = [...demoGrades.keys()].filter((id) =>
        demoSubmissionsFor(a.id).some((s) => s.id === id)).length;
      const mine = demoSubmissionsFor(a.id).find((s) => s.studentId === 'demo-user');
      return {
        ...a,
        ungradedCount: Math.max(0, a.ungradedCount - graded),
        mySubmission: a.mySubmission && mine
          ? { submittedAt: mine.submittedAt, marksAwarded: mine.marksAwarded, gradedAt: mine.gradedAt }
          : a.mySubmission,
      };
    }),
  };
}

/** The grade branch of POST /academics/assignments, in the service's order. */
function demoAssignmentsWrite(init: RequestInit): Response {
  if (['student', 'guardian'].includes(demoRole())) {
    return refuse(403, 'forbidden', 'this endpoint is restricted to staff');
  }
  const b = bodyOf<{
    submissionId: string; marksAwarded: unknown; feedbackBn: string; rowVersion: unknown;
  }>(init);
  if (!b.submissionId) {
    // Creating a homework writes a row every later read would have to show,
    // and this list is a constant — refused honestly, as exams are.
    return refuse(403, 'demo_read_only',
      'এটি প্রদর্শনী সংস্করণ — এখানে সত্যিকারের বাড়ির কাজ তৈরি হয় না।');
  }
  const marks = Number(b.marksAwarded);
  if (!Number.isFinite(marks) || marks < 0) {
    return refuse(400, 'invalid_marks', 'marksAwarded must be a non-negative number');
  }
  const rowVersion = Number(b.rowVersion);
  if (!Number.isInteger(rowVersion) || rowVersion < 1) {
    return refuse(400, 'row_version_required',
      'rowVersion is required — re-read the submission and send the version you graded');
  }
  const assignment = DEMO_ASSIGNMENTS.find((a) =>
    demoSubmissionsFor(a.id).some((s) => s.id === b.submissionId));
  const current = assignment && demoSubmissionsFor(assignment.id).find((s) => s.id === b.submissionId);
  if (!assignment || !current) return refuse(404, 'submission_not_found', 'submission not found');
  if (assignment.maxMarks !== null && marks > Number(assignment.maxMarks)) {
    return refuse(422, 'marks_exceed_max',
      `marksAwarded exceeds the assignment maximum of ${assignment.maxMarks}`);
  }
  if (current.rowVersion !== rowVersion) {
    return ok({
      error: 'grade_conflict',
      message: 'this submission was graded by someone else while you were working',
      conflict: {
        submissionId: current.id,
        expectedRowVersion: rowVersion,
        currentRowVersion: current.rowVersion,
        yours: { marksAwarded: marks, feedbackBn: b.feedbackBn ?? null },
        theirs: {
          marksAwarded: current.marksAwarded, feedbackBn: current.feedbackBn,
          gradedAt: current.gradedAt, gradedByName: current.gradedByName,
        },
      },
    }, 409);
  }
  const next = current.rowVersion + 1;
  demoGrades.set(current.id, {
    marksAwarded: marks.toFixed(2), feedbackBn: b.feedbackBn ?? null,
    gradedAt: new Date().toISOString(), rowVersion: next, gradedByName: 'ডেমো শিক্ষক',
  });
  return ok({ ok: true, submissionId: current.id, rowVersion: next });
}

// ── Bills, the counter and receipts (finding 31) ────────────────────────

/**
 * A guardian's two children, named once. The guardian home, the fee screen
 * (which names a child from this list), the counter sheet and the printed
 * documents all read it, so one child is never two names.
 */
const DEMO_WARDS = [
  { studentId: 'demo-s1', enrolmentId: 'demo-e1', nameBn: 'রাফির হাসান',
    sectionLabel: 'নবম–ক', rollNo: 7, relationBn: 'পিতা' },
  { studentId: 'demo-s2', enrolmentId: 'demo-e2', nameBn: 'তাহিয়া হাসান',
    sectionLabel: 'পঞ্চম–খ', rollNo: 3, relationBn: 'পিতা' },
];

/** COLLECT_ROLES, METHODS and METHOD_BN in services/finance-svc/api/payments.ts. */
const COLLECT_ROLES = ['principal', 'school_owner', 'accountant'];
const PAYMENT_METHODS = ['cash', 'cheque', 'bank_transfer', 'bkash', 'nagad', 'rocket', 'upay'];
const PAYMENT_METHOD_BN: Record<string, string> = {
  cash: 'নগদ', cheque: 'চেক', bank_transfer: 'ব্যাংক ট্রান্সফার',
  bkash: 'বিকাশ', nagad: 'নগদ (Nagad)', rocket: 'রকেট', upay: 'উপায়',
};

interface DemoReceipt {
  id: string; receiptNo: string; invoiceId: string; amount: number; method: string;
  issuedAt: string; issuedByBn: string | null; gatewayTrxId: string | null;
}

/** What was paid before the preview opened — the fixture's `paid` invoices. */
const DEMO_RECEIPTS: DemoReceipt[] = [
  { id: 'demo-rcp-inv2', receiptNo: 'RCP-2026-07-00012', invoiceId: 'demo-inv-2', amount: 1250,
    method: 'bkash', issuedAt: '2026-07-08T10:12:00Z', issuedByBn: null, gatewayTrxId: 'BK7Q2M9LPX' },
  { id: 'demo-rcp-inv3', receiptNo: 'RCP-2026-06-00009', invoiceId: 'demo-inv-3', amount: 750,
    method: 'cash', issuedAt: '2026-06-05T09:40:00Z', issuedByBn: 'হিসাবরক্ষক', gatewayTrxId: null },
  { id: 'demo-rcp-inv5', receiptNo: 'RCP-2026-07-00019', invoiceId: 'demo-inv-5', amount: 1100,
    method: 'nagad', issuedAt: '2026-07-09T11:20:00Z', issuedByBn: null, gatewayTrxId: 'NG4T8K1ZQW' },
];

/** Money taken at the demo counter this session. */
const demoCounterReceipts: DemoReceipt[] = [];

const allDemoReceipts = (): DemoReceipt[] => [...DEMO_RECEIPTS, ...demoCounterReceipts];

/** An invoice as it stands now: the fixture plus whatever the counter took. */
function demoInvoiceNow(inv: typeof DEMO_INVOICES[number]): typeof DEMO_INVOICES[number] {
  const taken = demoCounterReceipts
    .filter((r) => r.invoiceId === inv.id)
    .reduce((sum, r) => sum + r.amount, 0);
  if (taken === 0) return inv;
  const paid = Number(inv.paidAmount) + taken;
  const balance = Math.max(0, Number(inv.totalAmount) - paid);
  return {
    ...inv,
    paidAmount: paid.toFixed(2),
    balanceAmount: balance.toFixed(2),
    // app.apply_payment_to_invoice's two outcomes.
    status: balance <= 0 ? 'paid' : 'partly_paid',
  };
}

/**
 * `invoice_scope`: staff read every bill, a guardian their wards', a student
 * their own. `?studentId=` narrows it, as the service does.
 */
function demoInvoicesVisible(studentId: string | null): typeof DEMO_INVOICES {
  const role = demoRole();
  const mine = role === 'guardian' ? DEMO_WARDS.map((w) => w.studentId)
    : role === 'student' ? ['demo-s1']
      : null;
  return DEMO_INVOICES
    .filter((i) => !mine || mine.includes(i.studentId))
    .filter((i) => !studentId || i.studentId === studentId)
    .map(demoInvoiceNow)
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.invoiceNo.localeCompare(a.invoiceNo));
}

function demoReceipts(url: URL): Response {
  const invoiceId = url.searchParams.get('invoiceId');
  const inv = invoiceId ? demoInvoicesVisible(null).find((i) => i.id === invoiceId) : null;
  return ok({
    receipts: inv
      ? allDemoReceipts()
          .filter((r) => r.invoiceId === inv.id)
          .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
          .map((r) => ({
            id: r.id, receiptNo: r.receiptNo, amount: r.amount.toFixed(2), method: r.method,
            issuedAt: r.issuedAt, gatewayTrxId: r.gatewayTrxId, pdfObjectKey: null,
          }))
      : [],
  });
}

/**
 * GET/POST /finance/payments. It had no case at all, so আদায় লিখুন always
 * failed with "বিলের তথ্য আনা যায়নি।" and the payment sheet could never be
 * opened in the preview (finding 31).
 */
function demoPayments(url: URL, init: RequestInit): Response {
  const role = demoRole();
  if (methodOf(init) === 'GET') {
    const inv = DEMO_INVOICES.find((i) => i.id === url.searchParams.get('invoiceId'));
    if (!url.searchParams.get('invoiceId')) {
      return refuse(400, 'invoice_required', 'কোন বিল তা জানানো হয়নি।', { field: 'invoiceId' });
    }
    if (!inv) return refuse(404, 'invoice_not_found', 'বিলটি পাওয়া যায়নি।');
    const now = demoInvoiceNow(inv);
    return ok({
      canCollect: COLLECT_ROLES.includes(role),
      methods: PAYMENT_METHODS.map((m) => ({ code: m, labelBn: PAYMENT_METHOD_BN[m] ?? m })),
      invoice: {
        id: now.id, invoiceNo: now.invoiceNo, studentId: now.studentId,
        studentBn: DEMO_WARDS.find((w) => w.studentId === now.studentId)?.nameBn ?? '',
        billingPeriod: now.billingPeriod,
        totalAmount: Number(now.totalAmount), paidAmount: Number(now.paidAmount),
        balanceAmount: Number(now.balanceAmount), status: now.status, dueOn: now.dueOn,
      },
      receipts: allDemoReceipts()
        .filter((r) => r.invoiceId === now.id)
        .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
        .map((r) => ({
          id: r.id, receiptNo: r.receiptNo, amount: r.amount, method: r.method,
          methodBn: PAYMENT_METHOD_BN[r.method] ?? r.method,
          issuedAt: r.issuedAt, issuedByBn: r.issuedByBn,
        })),
    });
  }
  if (methodOf(init) !== 'POST') return ok({ error: 'method_not_allowed' }, 405);

  const b = bodyOf<{ invoiceId: string; amount: number | string; method: string; reference: string }>(init);
  const invoiceId = String(b.invoiceId ?? '').trim();
  if (!invoiceId) {
    return refuse(400, 'invoice_required', 'কোন বিল তা জানানো হয়নি।', { field: 'invoiceId' });
  }
  const method = String(b.method ?? '').trim();
  if (!PAYMENT_METHODS.includes(method)) {
    return refuse(400, 'bad_method', 'কীভাবে টাকা এসেছে তা বেছে নিন।', { field: 'method' });
  }
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return refuse(400, 'bad_amount', 'টাকার অঙ্ক শূন্যের বেশি হতে হবে।', { field: 'amount' });
  }
  const paid = Math.round(amount * 100) / 100;
  const base = DEMO_INVOICES.find((i) => i.id === invoiceId);
  if (!base) return refuse(404, 'invoice_not_found', 'বিলটি পাওয়া যায়নি।');
  const inv = demoInvoiceNow(base);
  const balance = Number(inv.balanceAmount);
  if (balance <= 0) return refuse(409, 'already_settled', 'এই বিলের সব টাকা ইতিমধ্যে পরিশোধিত।');
  if (paid > balance) {
    return refuse(409, 'over_payment', `বকেয়া ৳${balance.toFixed(2)} — এর বেশি নেওয়া যাবে না।`,
      { field: 'amount', balance });
  }

  // app.next_receipt_no(): RCP-YYYY-MM-NNNNN, numbered within the Dhaka month.
  const issuedAt = new Date();
  const month = todayIso(issuedAt).slice(0, 7);
  const inMonth = allDemoReceipts().filter((r) => r.receiptNo.startsWith(`RCP-${month}-`)).length;
  const receipt: DemoReceipt = {
    id: `demo-rcp-counter-${demoCounterReceipts.length + 1}`,
    receiptNo: `RCP-${month}-${String(inMonth + 1).padStart(5, '0')}`,
    invoiceId, amount: paid, method, issuedAt: issuedAt.toISOString(),
    issuedByBn: role === 'accountant' ? 'হিসাবরক্ষক' : 'প্রধান শিক্ষক',
    gatewayTrxId: null,
  };
  demoCounterReceipts.push(receipt);
  return ok({
    ok: true,
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
    amount: paid,
    method,
    methodBn: PAYMENT_METHOD_BN[method] ?? method,
    invoiceStatus: demoInvoiceNow(base).status,
    // The demo school's chart of accounts is seeded (DEMO_LEDGER), so the
    // two ledger rows would post.
    ledgerPosted: true,
  });
}

/**
 * A guardian home's fee figures, computed from the bills rather than typed
 * beside them — the panel said ৳1,500 over a fee screen that said ৳1,250.
 */
function demoWardFees(studentId: string): { outstanding: number; earliestDue: string | null; overdueCount: number } {
  const open = demoInvoicesVisible(studentId).filter((i) => Number(i.balanceAmount) > 0);
  const today = todayIso();
  return {
    outstanding: open.reduce((sum, i) => sum + Number(i.balanceAmount), 0),
    earliestDue: open.map((i) => i.dueOn).sort()[0] ?? null,
    overdueCount: open.filter((i) => i.dueOn < today).length,
  };
}

// ── The price list (finding 35) ─────────────────────────────────────────

/** FEE_ADMIN_ROLES in services/finance-svc/api/feestructures.ts. */
const FEE_ADMIN_ROLES = ['principal', 'school_owner', 'accountant', 'it_admin'];

const DEMO_FEE_YEARS = [
  { id: 'demo-year', label: '২০২৬', isCurrent: true },
  { id: 'demo-year-prev', label: '২০২৫', isCurrent: false },
];

const DEMO_FEE_CLASSES = [
  { id: 'demo-cls-5', nameBn: 'পঞ্চম শ্রেণি' },
  { id: 'demo-cls-6', nameBn: 'ষষ্ঠ শ্রেণি' },
  { id: 'demo-cls-7', nameBn: 'সপ্তম শ্রেণি' },
  { id: 'demo-cls-8', nameBn: 'অষ্টম শ্রেণি' },
  { id: 'demo-cls-9sci', nameBn: 'নবম শ্রেণি' },
  { id: 'demo-cls-10sci', nameBn: 'দশম শ্রেণি' },
];

/** The six heads `app.provision_tenant` seeds for every new school. */
const DEMO_FEE_HEADS = [
  { id: 'demo-fh-admission', nameBn: 'ভর্তি ফি', code: 'ADMISSION', frequency: 'one_time', isActive: true },
  { id: 'demo-fh-tuition', nameBn: 'মাসিক বেতন', code: 'TUITION', frequency: 'monthly', isActive: true },
  { id: 'demo-fh-exam', nameBn: 'পরীক্ষার ফি', code: 'EXAM', frequency: 'exam', isActive: true },
  { id: 'demo-fh-session', nameBn: 'সেশন চার্জ', code: 'SESSION', frequency: 'annual', isActive: true },
  { id: 'demo-fh-transport', nameBn: 'পরিবহন ফি', code: 'TRANSPORT', frequency: 'monthly', isActive: true },
  { id: 'demo-fh-library', nameBn: 'গ্রন্থাগার ফি', code: 'LIBRARY', frequency: 'annual', isActive: true },
];

interface DemoFeeStructure {
  id: string; feeHeadId: string; academicYearId: string; classId: string | null;
  amount: number; lateFeePerDay: number; lateFeeCap: number | null; dueDayOfMonth: number | null;
}

/**
 * The price list the demo's bills were made from: মাসিক বেতন ৳1,000 and
 * পরিবহন ফি ৳250 school-wide are Rafi's August lines, and Class 5's ৳850 is
 * Tahiya's. Two non-monthly heads, so the "not billed by the monthly run"
 * note shows. Mutable, so a save holds until the page is closed.
 */
const demoFeeStructures: DemoFeeStructure[] = [
  { id: 'demo-fs-1', feeHeadId: 'demo-fh-tuition', academicYearId: 'demo-year', classId: null,
    amount: 1000, lateFeePerDay: 10, lateFeeCap: 200, dueDayOfMonth: 10 },
  { id: 'demo-fs-2', feeHeadId: 'demo-fh-tuition', academicYearId: 'demo-year', classId: 'demo-cls-5',
    amount: 850, lateFeePerDay: 10, lateFeeCap: 200, dueDayOfMonth: 10 },
  { id: 'demo-fs-3', feeHeadId: 'demo-fh-tuition', academicYearId: 'demo-year', classId: 'demo-cls-10sci',
    amount: 1200, lateFeePerDay: 10, lateFeeCap: 200, dueDayOfMonth: 10 },
  { id: 'demo-fs-4', feeHeadId: 'demo-fh-transport', academicYearId: 'demo-year', classId: null,
    amount: 250, lateFeePerDay: 0, lateFeeCap: null, dueDayOfMonth: 10 },
  { id: 'demo-fs-5', feeHeadId: 'demo-fh-exam', academicYearId: 'demo-year', classId: null,
    amount: 300, lateFeePerDay: 0, lateFeeCap: null, dueDayOfMonth: null },
  { id: 'demo-fs-6', feeHeadId: 'demo-fh-session', academicYearId: 'demo-year', classId: null,
    amount: 1500, lateFeePerDay: 0, lateFeeCap: null, dueDayOfMonth: null },
  { id: 'demo-fs-7', feeHeadId: 'demo-fh-tuition', academicYearId: 'demo-year-prev', classId: null,
    amount: 900, lateFeePerDay: 10, lateFeeCap: 200, dueDayOfMonth: 10 },
];
let demoFeeSeq = demoFeeStructures.length;

function demoFeeShape(s: DemoFeeStructure): unknown {
  const head = DEMO_FEE_HEADS.find((h) => h.id === s.feeHeadId)!;
  return {
    id: s.id, feeHeadId: s.feeHeadId, headBn: head.nameBn, headCode: head.code,
    frequency: head.frequency, headActive: head.isActive,
    academicYearId: s.academicYearId, classId: s.classId,
    classBn: DEMO_FEE_CLASSES.find((c) => c.id === s.classId)?.nameBn ?? null,
    amount: s.amount, lateFeePerDay: s.lateFeePerDay, lateFeeCap: s.lateFeeCap,
    dueDayOfMonth: s.dueDayOfMonth,
    billedByMonthlyRun: head.frequency === 'monthly' && head.isActive,
  };
}

/** `money()` and `validate()` in feestructures.ts: the same refusals, the same words. */
function demoFeeValidate(b: {
  amount?: unknown; lateFeePerDay?: unknown; lateFeeCap?: unknown; dueDayOfMonth?: unknown;
}): Response | { amount: number; lateFeePerDay: number; lateFeeCap: number | null; dueDay: number | null } {
  const money = (v: unknown, field: string, label: string): Response | number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return refuse(400, 'bad_amount', `${label} ঋণাত্মক হতে পারে না।`, { field });
    if (n > 10_000_000) return refuse(400, 'bad_amount', `${label} অনেক বেশি — আবার দেখুন।`, { field });
    return Math.round(n * 100) / 100;
  };
  const amount = money(b.amount, 'amount', 'টাকার অঙ্ক');
  if (amount instanceof Response) return amount;
  if (amount === null) return refuse(400, 'bad_amount', 'টাকার অঙ্ক লিখুন।', { field: 'amount' });
  const lateFeePerDay = money(b.lateFeePerDay, 'lateFeePerDay', 'দৈনিক বিলম্ব ফি');
  if (lateFeePerDay instanceof Response) return lateFeePerDay;
  const lateFeeCap = money(b.lateFeeCap, 'lateFeeCap', 'বিলম্ব ফির সর্বোচ্চ সীমা');
  if (lateFeeCap instanceof Response) return lateFeeCap;
  let dueDay: number | null = null;
  if (b.dueDayOfMonth !== undefined && b.dueDayOfMonth !== null) {
    dueDay = Number(b.dueDayOfMonth);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      return refuse(400, 'bad_due_day', 'শেষ তারিখ ১ থেকে ২৮-এর মধ্যে দিন।', { field: 'dueDayOfMonth' });
    }
  }
  return { amount, lateFeePerDay: lateFeePerDay ?? 0, lateFeeCap, dueDay };
}

function demoFeeStructuresHandler(url: URL, init: RequestInit): Response {
  const role = demoRole();
  const method = methodOf(init);
  if (method === 'GET') {
    const wanted = url.searchParams.get('yearId');
    const year = DEMO_FEE_YEARS.find((y) => y.id === wanted) ?? DEMO_FEE_YEARS.find((y) => y.isCurrent)!;
    const freqOf = (s: DemoFeeStructure) => DEMO_FEE_HEADS.find((h) => h.id === s.feeHeadId)!;
    const classOrder = (id: string | null) => (id === null ? -1 : DEMO_FEE_CLASSES.findIndex((c) => c.id === id));
    return ok({
      canManage: FEE_ADMIN_ROLES.includes(role),
      academicYearId: year.id,
      years: DEMO_FEE_YEARS,
      classes: DEMO_FEE_CLASSES,
      heads: DEMO_FEE_HEADS,
      // ORDER BY fh.frequency, fh.name_bn, cl.level_no NULLS FIRST
      structures: demoFeeStructures
        .filter((s) => s.academicYearId === year.id)
        .sort((a, b) => freqOf(a).frequency.localeCompare(freqOf(b).frequency)
          || freqOf(a).nameBn.localeCompare(freqOf(b).nameBn)
          || classOrder(a.classId) - classOrder(b.classId))
        .map(demoFeeShape),
    });
  }
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) return ok({ error: 'method_not_allowed' }, 405);
  if (!FEE_ADMIN_ROLES.includes(role)) {
    return refuse(403, 'forbidden', `this endpoint requires one of: ${FEE_ADMIN_ROLES.join(', ')}`);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) return refuse(400, 'structure_required', 'কোন ফি তা জানানো হয়নি।', { field: 'id' });
    const at = demoFeeStructures.findIndex((s) => s.id === id);
    if (at < 0) return refuse(404, 'structure_not_found', 'এই ফি-টি পাওয়া যায়নি।');
    const [gone] = demoFeeStructures.splice(at, 1);
    const head = DEMO_FEE_HEADS.find((h) => h.id === gone.feeHeadId)!;
    return ok({ id, headBn: head.nameBn, issuedInvoicesUnaffected: true });
  }

  const b = bodyOf<{
    id: string; feeHeadId: string; academicYearId: string; classId: string | null;
    amount: number; lateFeePerDay: number | null; lateFeeCap: number | null; dueDayOfMonth: number | null;
  }>(init);

  if (method === 'PATCH') {
    const was = demoFeeStructures.find((s) => s.id === (b.id ?? '').trim());
    if (!b.id) return refuse(400, 'structure_required', 'কোন ফি তা জানানো হয়নি।', { field: 'id' });
    if (!was) return refuse(404, 'structure_not_found', 'এই ফি-টি পাওয়া যায়নি।');
    // PATCH carries the unnamed fields across, as the service does.
    const v = demoFeeValidate({
      amount: b.amount ?? was.amount,
      lateFeePerDay: b.lateFeePerDay !== undefined ? b.lateFeePerDay : was.lateFeePerDay,
      lateFeeCap: b.lateFeeCap !== undefined ? b.lateFeeCap : was.lateFeeCap,
      dueDayOfMonth: b.dueDayOfMonth !== undefined ? b.dueDayOfMonth : was.dueDayOfMonth,
    });
    if (v instanceof Response) return v;
    Object.assign(was, {
      amount: v.amount, lateFeePerDay: v.lateFeePerDay, lateFeeCap: v.lateFeeCap, dueDayOfMonth: v.dueDay,
    });
    return ok({ id: was.id, headBn: DEMO_FEE_HEADS.find((h) => h.id === was.feeHeadId)!.nameBn, amount: v.amount });
  }

  if (!b.feeHeadId) return refuse(400, 'bad_head', 'কোন ফি তা বেছে নিন।', { field: 'feeHeadId' });
  if (!b.academicYearId) return refuse(400, 'bad_year', 'শিক্ষাবর্ষ বেছে নিন।', { field: 'academicYearId' });
  const classId = b.classId ? String(b.classId) : null;
  const v = demoFeeValidate(b);
  if (v instanceof Response) return v;
  const head = DEMO_FEE_HEADS.find((h) => h.id === b.feeHeadId);
  if (!head) return refuse(404, 'head_not_found', 'ফি-এর খাতটি পাওয়া যায়নি।');
  if (!DEMO_FEE_YEARS.some((y) => y.id === b.academicYearId)) {
    return refuse(404, 'year_not_found', 'শিক্ষাবর্ষটি পাওয়া যায়নি।');
  }
  if (classId && !DEMO_FEE_CLASSES.some((c) => c.id === classId)) {
    return refuse(404, 'class_not_found', 'শ্রেণিটি পাওয়া যায়নি।');
  }
  if (demoFeeStructures.some((s) => s.feeHeadId === head.id
    && s.academicYearId === b.academicYearId && s.classId === classId)) {
    return refuse(409, 'duplicate_structure',
      'এই শিক্ষাবর্ষে এই শ্রেণির জন্য এই ফি ইতিমধ্যে নির্ধারিত আছে।', { field: 'feeHeadId' });
  }
  const id = `demo-fs-${++demoFeeSeq}`;
  demoFeeStructures.push({
    id, feeHeadId: head.id, academicYearId: b.academicYearId, classId,
    amount: v.amount, lateFeePerDay: v.lateFeePerDay, lateFeeCap: v.lateFeeCap, dueDayOfMonth: v.dueDay,
  });
  return ok({ id, headBn: head.nameBn, amount: v.amount });
}

// ── Rooms (findings 47, 63) ─────────────────────────────────────────────

/** ROOM_ROLES in services/rms-svc/api/rooms.ts. */
const ROOM_ROLES = ['principal', 'school_owner', 'academic_coordinator', 'it_admin'];
/** Every `requires_capability` the NCTB subject catalogue names. */
const DEMO_ROOM_CAPABILITIES = ['biology_lab', 'chemistry_lab', 'computer', 'physics_lab'];

interface DemoRoom {
  id: string; code: string; nameBn: string | null; building: string | null;
  floorNo: number | null; capacity: number | null; capabilities: string[];
  isBookable: boolean; homeSections: number; slotCount: number; hallCount: number;
}

/**
 * The rooms the rest of the preview already names — ১০১, ১০২ and ১০৪ on a
 * student's day, ২০৪ on a teacher's, ল্যাব-১ for physics — so the room list
 * and the routines describe one building. One room is out of service, and
 * two carry exam halls, so the chip and the take-out-of-service consequences
 * both have something to say.
 */
const demoRooms: DemoRoom[] = [
  { id: 'demo-room-101', code: '১০১', nameBn: 'নবম ক শ্রেণিকক্ষ', building: 'প্রধান ভবন', floorNo: 1,
    capacity: 60, capabilities: [], isBookable: true, homeSections: 1, slotCount: 34, hallCount: 1 },
  { id: 'demo-room-102', code: '১০২', nameBn: 'নবম খ শ্রেণিকক্ষ', building: 'প্রধান ভবন', floorNo: 1,
    capacity: 60, capabilities: [], isBookable: true, homeSections: 1, slotCount: 32, hallCount: 1 },
  { id: 'demo-room-104', code: '১০৪', nameBn: null, building: 'প্রধান ভবন', floorNo: 1,
    capacity: 40, capabilities: [], isBookable: true, homeSections: 0, slotCount: 12, hallCount: 0 },
  { id: 'demo-room-204', code: '২০৪', nameBn: 'দশম ক শ্রেণিকক্ষ', building: 'প্রধান ভবন', floorNo: 2,
    capacity: 55, capabilities: [], isBookable: true, homeSections: 1, slotCount: 30, hallCount: 0 },
  { id: 'demo-room-lab1', code: 'ল্যাব-১', nameBn: 'পদার্থবিজ্ঞান ও রসায়ন ল্যাব', building: 'বিজ্ঞান ভবন',
    floorNo: 0, capacity: 30, capabilities: ['chemistry_lab', 'physics_lab'], isBookable: true,
    homeSections: 0, slotCount: 14, hallCount: 0 },
  { id: 'demo-room-ict', code: 'আইসিটি', nameBn: 'কম্পিউটার ল্যাব', building: 'বিজ্ঞান ভবন',
    floorNo: 1, capacity: 36, capabilities: ['computer'], isBookable: true,
    homeSections: 0, slotCount: 8, hallCount: 0 },
  { id: 'demo-room-301', code: '৩০১', nameBn: null, building: 'প্রধান ভবন', floorNo: 3,
    capacity: 45, capabilities: [], isBookable: false, homeSections: 0, slotCount: 0, hallCount: 0 },
];

/** `clean()` in rooms.ts, with its refusals and its words. */
function demoRoomClean(b: {
  code?: unknown; nameBn?: unknown; building?: unknown; floorNo?: unknown;
  capacity?: unknown; capabilities?: unknown;
}): Response | Omit<DemoRoom, 'id' | 'isBookable' | 'homeSections' | 'slotCount' | 'hallCount'> {
  const code = String(b.code ?? '').trim();
  if (!code) return refuse(400, 'bad_code', 'কক্ষের কোড লিখুন।', { field: 'code' });
  if (code.length > 20) return refuse(400, 'bad_code', 'কোড 20 অক্ষরের মধ্যে দিন।', { field: 'code' });
  const nameBn = String(b.nameBn ?? '').trim();
  if (nameBn.length > 80) return refuse(400, 'bad_name', 'নাম 80 অক্ষরের মধ্যে দিন।', { field: 'nameBn' });
  const building = String(b.building ?? '').trim();
  if (building.length > 60) {
    return refuse(400, 'bad_building', 'ভবনের নাম 60 অক্ষরের মধ্যে দিন।', { field: 'building' });
  }
  const floorNo = b.floorNo === undefined || b.floorNo === null ? null : Number(b.floorNo);
  if (floorNo !== null && (!Number.isInteger(floorNo) || floorNo < -2 || floorNo > 20)) {
    return refuse(400, 'bad_floor', 'তলা -2 থেকে 20-এর মধ্যে দিন।', { field: 'floorNo' });
  }
  const capacity = b.capacity === undefined ? 60 : Number(b.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
    return refuse(400, 'bad_capacity', 'ধারণক্ষমতা 1 থেকে 1000-এর মধ্যে দিন।', { field: 'capacity' });
  }
  let capabilities: string[] = [];
  if (b.capabilities !== undefined) {
    if (!Array.isArray(b.capabilities)) {
      return refuse(400, 'bad_capabilities', 'সুবিধার তালিকা সঠিক নয়।', { field: 'capabilities' });
    }
    capabilities = [...new Set(b.capabilities.map((x) => String(x).trim()).filter(Boolean))].sort();
    if (capabilities.length > 8) {
      return refuse(400, 'bad_capabilities', 'সুবিধা ৮টির বেশি দেওয়া যাবে না।', { field: 'capabilities' });
    }
    const unknown = capabilities.find((c) => !DEMO_ROOM_CAPABILITIES.includes(c));
    if (unknown) {
      return refuse(400, 'bad_capability',
        `"${unknown}" — এই সুবিধাটি কোনো বিষয়ের জন্য দরকার হয় না।`, { field: 'capabilities' });
    }
  }
  return { code, nameBn: nameBn || null, building: building || null, floorNo, capacity, capabilities };
}

function demoRoomsHandler(init: RequestInit): Response {
  const role = demoRole();
  const method = methodOf(init);
  if (method === 'GET') {
    return ok({
      canManage: ROOM_ROLES.includes(role),
      capabilityOptions: DEMO_ROOM_CAPABILITIES,
      // ORDER BY r.is_bookable DESC, r.code
      rooms: [...demoRooms].sort((a, b) =>
        Number(b.isBookable) - Number(a.isBookable) || a.code.localeCompare(b.code)),
    });
  }
  if (method !== 'POST' && method !== 'PATCH') return ok({ error: 'method_not_allowed' }, 405);
  if (!ROOM_ROLES.includes(role)) {
    return refuse(403, 'forbidden', `this endpoint requires one of: ${ROOM_ROLES.join(', ')}`);
  }
  const b = bodyOf<DemoRoom & { capabilities: unknown }>(init);

  if (method === 'POST') {
    const v = demoRoomClean(b);
    if (v instanceof Response) return v;
    if (demoRooms.some((r) => r.code === v.code)) {
      return refuse(409, 'duplicate_code', 'এই কোডের কক্ষ ইতিমধ্যে আছে।', { field: 'code' });
    }
    const room: DemoRoom = {
      id: `demo-room-new-${demoRooms.length + 1}`, ...v,
      isBookable: true, homeSections: 0, slotCount: 0, hallCount: 0,
    };
    demoRooms.push(room);
    return ok(room);
  }

  const id = String(b.id ?? '').trim();
  if (!id) return refuse(400, 'room_required', 'কোন কক্ষ তা জানানো হয়নি।', { field: 'id' });
  const was = demoRooms.find((r) => r.id === id);
  if (!was) return refuse(404, 'room_not_found', 'এই কক্ষটি পাওয়া যায়নি।');
  // PATCH carries every field the caller omitted, so taking a room out of
  // service cannot reset its capacity or wipe its lab flag.
  const v = demoRoomClean({
    code: b.code ?? was.code,
    nameBn: b.nameBn ?? was.nameBn ?? '',
    building: b.building ?? was.building ?? '',
    floorNo: b.floorNo !== undefined ? b.floorNo : was.floorNo,
    capacity: b.capacity ?? was.capacity ?? 60,
    capabilities: b.capabilities ?? was.capabilities,
  });
  if (v instanceof Response) return v;
  if (demoRooms.some((r) => r.id !== id && r.code === v.code)) {
    return refuse(409, 'duplicate_code', 'এই কোডের কক্ষ ইতিমধ্যে আছে।', { field: 'code' });
  }
  Object.assign(was, v, {
    isBookable: b.isBookable === undefined ? was.isBookable : Boolean(b.isBookable),
  });
  return ok(was);
}

// ── The staff directory (minors 70, 95) ─────────────────────────────────

/** USER_ADMIN_ROLES and GRANTABLE in services/ops-svc/api/users.ts. */
const USER_ADMIN_ROLES = ['principal', 'school_owner', 'it_admin'];
const USER_GRANTABLE = ['principal', 'academic_coordinator', 'dept_head', 'accountant',
  'class_teacher', 'subject_teacher', 'librarian', 'it_admin'];
const USER_SEARCH_LIMIT = 50;

interface DemoUser {
  id: string; nameBn: string; nameEn: string | null; phone: string | null;
  status: string; roles: string[]; employeeCode: string | null; studentCode: string | null;
  createdAt: string;
}

/**
 * The school's people, as GET /ops/users lists them. It used to be a constant
 * answered whatever was asked: the role filter and the search changed nothing,
 * a deactivated teacher stayed "সক্রিয়" under the note that said otherwise, and
 * a new account was announced and never listed. Mutable now, so a write holds
 * for the life of the page and the screen's reload shows it.
 *
 * The teachers are the ones the rest of the preview names — the assignment
 * screen's five (শুভ স্যার has left) and the teachers a student's day names —
 * so the register, the routines and this list describe one staff room.
 */
const demoUsers: DemoUser[] = [
  ['demo-t1', 'রহিম স্যার', null, 'class_teacher', 'active', 'T-101'],
  ['demo-t2', 'করিম স্যার', null, 'subject_teacher', 'active', 'T-102'],
  ['demo-t3', 'হাসান স্যার', null, 'subject_teacher', 'active', 'T-103'],
  ['demo-t4', 'নাঈম স্যার', null, 'subject_teacher', 'active', 'T-104'],
  ['demo-t5', 'শুভ স্যার', null, 'subject_teacher', 'left', 'T-105'],
  ['demo-t6', 'নাজমা সুলতানা', 'Nazma Sultana', 'class_teacher', 'active', 'T-106'],
  ['demo-t7', 'মাওলানা ইদ্রিস', null, 'subject_teacher', 'active', 'T-107'],
  ['demo-t8', 'রফিকুল ইসলাম', 'Rafiqul Islam', 'academic_coordinator', 'active', 'T-108'],
  ['demo-t9', 'শাহনাজ পারভীন', 'Shahnaz Parvin', 'subject_teacher', 'active', 'T-109'],
  ['demo-t10', 'ফারহানা ইয়াসমিন', 'Farhana Yasmin', 'subject_teacher', 'active', 'T-110'],
  ['demo-acc', 'মোঃ জাহিদুল ইসলাম', 'Md Zahidul Islam', 'accountant', 'active', 'S-201'],
  ['demo-it', 'আইটি অ্যাডমিন', null, 'it_admin', 'active', 'S-202'],
].map(([id, nameBn, nameEn, role, status, employeeCode], i) => ({
  id: id as string, nameBn: nameBn as string, nameEn: nameEn as string | null,
  // E.164, Latin — an identifier, not a count.
  phone: `+88017110${String(20 + i).padStart(5, '0')}`,
  status: status as string, roles: [role as string],
  employeeCode: employeeCode as string, studentCode: null,
  createdAt: `2024-01-${String(5 + i).padStart(2, '0')}T09:00:00+06:00`,
}));

/** `normalisePhone` in users.ts: the same three accepted shapes, the same refusal. */
function demoNormalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+8801[3-9]\d{8}$/.test(digits)) return digits;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  return null;
}

function demoUsersHandler(url: URL, init: RequestInit, selfId: string): Response {
  const role = demoRole();
  const method = methodOf(init);

  if (method === 'GET') {
    // `search()`: a substring of either name, or an EXACT phone or code —
    // a partial phone is a contact-list enumerator, so it matches nobody.
    const term = (url.searchParams.get('q') ?? '').trim();
    const wantRole = (url.searchParams.get('role') ?? '').trim();
    const status = (url.searchParams.get('status') ?? '').trim();
    const t = term.toLowerCase();
    const rows = demoUsers
      .filter((u) => !term
        || u.nameBn.toLowerCase().includes(t)
        || (u.nameEn ?? '').toLowerCase().includes(t)
        || u.phone === term || u.employeeCode === term || u.studentCode === term)
      .filter((u) => !status || u.status === status)
      .filter((u) => !wantRole || u.roles.includes(wantRole))
      .sort((a, b) => a.nameBn.localeCompare(b.nameBn, 'bn'))
      .slice(0, USER_SEARCH_LIMIT);
    return ok({
      users: rows.map((u) => ({ ...u, roles: [...u.roles] })),
      truncated: rows.length === USER_SEARCH_LIMIT,
      limit: USER_SEARCH_LIMIT,
    });
  }
  if (method !== 'POST' && method !== 'PATCH') return ok({ error: 'method_not_allowed' }, 405);
  if (!USER_ADMIN_ROLES.includes(role)) {
    return refuse(403, 'forbidden', `this endpoint requires one of: ${USER_ADMIN_ROLES.join(', ')}`);
  }

  if (method === 'POST') {
    const b = bodyOf<{
      nameBn: string; nameEn: string; phone: string; roleCode: string; employeeCode: string;
    }>(init);
    const nameBn = String(b.nameBn ?? '').trim();
    const roleCode = String(b.roleCode ?? '').trim();
    if (!nameBn) return refuse(400, 'bad_request', 'নাম লিখুন', { field: 'nameBn' });
    if (!USER_GRANTABLE.includes(roleCode)) {
      return refuse(400, 'bad_role', 'এই ভূমিকা দেওয়া যাবে না', { field: 'roleCode' });
    }
    const phone = demoNormalisePhone(String(b.phone ?? ''));
    if (!phone) return refuse(400, 'bad_phone', 'মোবাইল নম্বরটি ঠিক নয়', { field: 'phone' });
    const employeeCode = String(b.employeeCode ?? '').trim();
    if (!employeeCode) {
      return refuse(400, 'bad_request', 'কর্মচারী আইডি দিন', { field: 'employeeCode' });
    }
    const taken = demoUsers.find((u) => u.phone === phone);
    if (taken) {
      return refuse(409, 'phone_taken', `এই নম্বরটি ইতিমধ্যে ${taken.nameBn}-এর জন্য ব্যবহৃত`,
        { field: 'phone', existingId: taken.id });
    }
    if (demoUsers.some((u) => u.employeeCode === employeeCode)) {
      return refuse(409, 'duplicate_employee_code',
        `এই কর্মচারী আইডি (${employeeCode}) আগেই ব্যবহার করা হয়েছে`, { field: 'employeeCode' });
    }
    const id = `demo-user-new-${demoUsers.length + 1}`;
    demoUsers.push({
      id, nameBn, nameEn: String(b.nameEn ?? '').trim() || nameBn, phone,
      // Invited, not active: the first sign-in is an activation code.
      status: 'invited', roles: [roleCode], employeeCode, studentCode: null,
      createdAt: new Date().toISOString(),
    });
    return ok({ id, nameBn, roleCode, status: 'invited' });
  }

  // PATCH — `setStatus()`: deactivate or reactivate, never delete.
  const b = bodyOf<{ userId: string; active: unknown }>(init);
  const userId = String(b.userId ?? '').trim();
  if (!userId) return refuse(400, 'bad_request', 'userId is required', { field: 'userId' });
  if (typeof b.active !== 'boolean') {
    return refuse(400, 'bad_request', 'active must be true or false', { field: 'active' });
  }
  if (userId === selfId && b.active === false) {
    return refuse(400, 'cannot_deactivate_self', 'নিজের অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না');
  }
  const user = demoUsers.find((u) => u.id === userId);
  if (!user) return refuse(404, 'not_found', 'ব্যবহারকারী পাওয়া যায়নি');
  const signedIn = user.status === 'active';
  user.status = b.active ? 'active' : 'left';
  return ok({
    id: user.id, nameBn: user.nameBn, status: user.status,
    // Deactivating ends the person's sessions; an invited account has none.
    sessionsRevoked: !b.active && signedIn ? 1 : 0,
  });
}

// ── Teachers' register (finding 47) ─────────────────────────────────────

/** MARK_ROLES in services/ops-svc/api/staff-attendance.ts. */
const STAFF_MARK_ROLES = ['principal', 'school_owner', 'it_admin', 'academic_coordinator'];
/** TEACHING_ROLES in staff-attendance.ts: who the register lists. */
const STAFF_TEACHING_ROLES = ['class_teacher', 'subject_teacher', 'dept_head', 'academic_coordinator'];

/**
 * Where each teacher sits in the book's pattern below, so a teacher's day
 * does not change when somebody else joins or leaves.
 */
const REGISTER_PATTERN: Record<string, number> = {
  'demo-t1': 0, 'demo-t2': 1, 'demo-t3': 2, 'demo-t4': 3, 'demo-t6': 4,
  'demo-t7': 5, 'demo-t8': 6, 'demo-t9': 7, 'demo-t10': 8,
};

/**
 * Who the register lists: ACTIVE staff holding a teaching role, by name —
 * read from the staff directory, so a teacher deactivated on the users screen
 * leaves the register, as the service's `u.status = 'active'` makes them.
 */
function demoRegisterTeachers(): Array<{ teacherId: string; bn: string; en: string | null; roleCode: string }> {
  return demoUsers
    .filter((u) => u.status === 'active' && u.roles.some((r) => STAFF_TEACHING_ROLES.includes(r)))
    .sort((a, b) => a.nameBn.localeCompare(b.nameBn, 'bn'))
    .map((u) => {
      // max(ur.role_code) over the teaching roles.
      const teaching = u.roles.filter((r) => STAFF_TEACHING_ROLES.includes(r)).sort();
      return { teacherId: u.id, bn: u.nameBn, en: u.nameEn, roleCode: teaching[teaching.length - 1] };
    });
}

/** Marks made in this preview, by `date|teacherId`. */
const demoStaffMarks = new Map<string, { status: string; reason: string | null; markedAt: string }>();

/**
 * What the office had already written in the book before the preview opened.
 * A past school day is fully marked; today is part-way, with one teacher on
 * leave and one away, so the "দূরে" figure and the unmarked rows both show;
 * a day ahead is blank.
 */
function demoStaffMarkFor(date: string, teacherId: string):
  { status: string | null; reason: string | null; markedAt: string | null; markedBy: string | null } {
  const own = demoStaffMarks.get(`${date}|${teacherId}`);
  if (own) return { ...own, markedBy: 'ডেমো' };
  const today = todayIso();
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // A teacher who joined in this preview has nothing in the book yet.
  const i = REGISTER_PATTERN[teacherId] ?? -1;
  if (i < 0 || date > today || weekday === 5 || weekday === 6) {
    return { status: null, reason: null, markedAt: null, markedBy: null };
  }
  const markedAt = `${date}T08:05:00+06:00`;
  if (i === 5) return { status: 'on_leave', reason: 'অসুস্থতাজনিত ছুটি', markedAt, markedBy: 'প্রধান শিক্ষক' };
  if (date === today && i === 2) return { status: 'absent', reason: null, markedAt, markedBy: 'প্রধান শিক্ষক' };
  if (date === today && i >= 7) return { status: null, reason: null, markedAt: null, markedBy: null };
  return { status: 'present', reason: null, markedAt, markedBy: 'প্রধান শিক্ষক' };
}

function demoStaffAttendance(url: URL, init: RequestInit): Response {
  const role = demoRole();
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

  if (methodOf(init) === 'GET') {
    const asked = url.searchParams.get('date');
    if (asked && !dateOk(asked)) return refuse(400, 'bad_date', 'তারিখ সঠিক নয়।');
    const date = asked ?? todayIso();
    // `users_scope`: a student or guardian cannot see the staff at all, so
    // the service's register comes back empty for them rather than refused.
    const visible = ['student', 'guardian'].includes(role) ? [] : demoRegisterTeachers();
    const teachers = visible.map((t) => {
      const m = demoStaffMarkFor(date, t.teacherId);
      return {
        teacherId: t.teacherId, name: { bn: t.bn, en: t.en }, roleCode: t.roleCode,
        status: m.status, reason: m.reason, markedAt: m.markedAt, markedBy: m.markedBy,
      };
    });
    return ok({
      date,
      canMark: STAFF_MARK_ROLES.includes(role),
      total: teachers.length,
      marked: teachers.filter((t) => t.status !== null).length,
      away: teachers.filter((t) => t.status === 'absent' || t.status === 'on_leave').length,
      teachers,
    });
  }
  if (methodOf(init) !== 'POST') return ok({ error: 'method_not_allowed' }, 405);
  if (!STAFF_MARK_ROLES.includes(role)) {
    return refuse(403, 'forbidden', `this endpoint requires one of: ${STAFF_MARK_ROLES.join(', ')}`);
  }
  const b = bodyOf<{ teacherId: string; date: string; status: string; reason: string }>(init);
  const status = b.status ?? '';
  const reason = String(b.reason ?? '').trim();
  if (!b.teacherId) return refuse(400, 'teacher_required', 'কোন শিক্ষক তা জানানো হয়নি।');
  if (!['present', 'absent', 'on_leave'].includes(status)) {
    return refuse(400, 'bad_status', 'উপস্থিতির অবস্থা সঠিক নয়।');
  }
  if (b.date !== undefined && !dateOk(b.date)) return refuse(400, 'bad_date', 'তারিখ সঠিক নয়।');
  if (reason.length > 200) return refuse(400, 'reason_too_long', 'কারণ 200 অক্ষরের মধ্যে লিখুন।');
  const teacher = demoRegisterTeachers().find((t) => t.teacherId === b.teacherId);
  if (!teacher) return refuse(404, 'teacher_not_found', 'এই শিক্ষককে পাওয়া যায়নি।');
  const date = b.date ?? todayIso();
  demoStaffMarks.set(`${date}|${teacher.teacherId}`, {
    status, reason: reason || null, markedAt: new Date().toISOString(),
  });
  return ok({ teacherId: teacher.teacherId, nameBn: teacher.bn, date, status, reason: reason || null });
}

// ── Where am I signed in (finding 47) ───────────────────────────────────

/**
 * `describe()` in services/identity-svc/api/sessions.ts: a browser family and
 * an OS family, never the whole user-agent string.
 */
function demoDeviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
      : /Linux/.test(ua) ? 'Linux' : '';
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'অজানা ডিভাইস';
}

/** The account's other devices; revoking one removes it for the rest of the visit. */
const demoOtherDevices = [
  { deviceId: 'demo-device-phone', label: 'Chrome · Android', signedDaysAgo: 12, seenHoursAgo: 20 },
  { deviceId: 'demo-device-office', label: 'Firefox · Windows', signedDaysAgo: 26, seenHoursAgo: 9 * 24 },
];

function demoSessions(url: URL, init: RequestInit, currentDevice: string): Response {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const expires = (signedDaysAgo: number) =>
    new Date(Date.now() + (30 - signedDaysAgo) * 86_400_000).toISOString();
  const revokeOthers = /revoke-others$/.test(url.pathname);
  const revokeOne = !revokeOthers && /revoke$/.test(url.pathname);

  if (methodOf(init) === 'GET' && !revokeOne && !revokeOthers) {
    const current = (url.searchParams.get('deviceId') ?? '').trim();
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '';
    return ok({
      sessions: [
        { deviceId: currentDevice, label: demoDeviceLabel(ua), current: current === currentDevice,
          signedInAt: hoursAgo(2), lastSeenAt: hoursAgo(0), expiresAt: expires(0) },
        ...demoOtherDevices.map((d) => ({
          deviceId: d.deviceId, label: d.label, current: d.deviceId === current,
          signedInAt: hoursAgo(d.signedDaysAgo * 24), lastSeenAt: hoursAgo(d.seenHoursAgo),
          expiresAt: expires(d.signedDaysAgo),
        })),
      ],
    });
  }
  if (methodOf(init) !== 'POST') return ok({ error: 'method_not_allowed' }, 405);
  const deviceId = String(bodyOf<{ deviceId: string }>(init).deviceId ?? '').trim();
  if (!deviceId) return refuse(400, 'device_required', 'deviceId is required');
  if (revokeOthers) {
    const revoked = demoOtherDevices.filter((d) => d.deviceId !== deviceId).length;
    demoOtherDevices.splice(0, demoOtherDevices.length,
      ...demoOtherDevices.filter((d) => d.deviceId === deviceId));
    return ok({ revoked });
  }
  if (revokeOne) {
    const at = demoOtherDevices.findIndex((d) => d.deviceId === deviceId);
    if (at >= 0) demoOtherDevices.splice(at, 1);
    return ok({ revoked: at >= 0 ? 1 : 0 });
  }
  return ok({ error: 'not_found' }, 404);
}

// ── Push notifications (finding 47) ─────────────────────────────────────

/**
 * GET /ops/push. `enabled: false` is the true state of a preview: there are
 * no VAPID keys behind it, and a dummy key would make the browser try a real
 * subscription that can only fail.
 */
function demoPush(init: RequestInit): Response {
  const method = methodOf(init);
  if (method === 'GET') return ok({ enabled: false, publicKey: null, devices: [] });
  if (method === 'POST') {
    return refuse(503, 'push_not_configured',
      'push notifications are not enabled on this deployment (VAPID_PUBLIC_KEY)');
  }
  // Unsubscribing is idempotent: nothing was subscribed, so nothing is removed.
  if (method === 'DELETE') return ok({ ok: true, removed: 0 });
  return ok({ error: 'method_not_allowed' }, 405);
}

// ── Activation codes (finding 45) ───────────────────────────────────────

/** ISSUER_ROLES in services/identity-svc/api/activate.ts. */
const ACTIVATION_ISSUER_ROLES = ['principal', 'school_owner', 'academic_coordinator', 'class_teacher'];
/** services/identity-svc/src/activation.ts: no 0/O, 1/I/L or 9 to misread off a slip. */
const ACTIVATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ2345678';

function demoActivate(init: RequestInit): Response {
  if (methodOf(init) !== 'POST') return ok({ error: 'method_not_allowed' }, 405);
  const b = bodyOf<{ action: string; userId: string }>(init);
  if (b.action !== 'issue') {
    // Redeeming is how a person signs in, and the preview has no sign-in.
    return refuse(400, 'invalid_action', "action must be 'issue' or 'redeem'");
  }
  const role = demoRole();
  if (!ACTIVATION_ISSUER_ROLES.includes(role)) {
    // An IT admin administers accounts but does not hand out codes: the
    // service refuses them here, and so does the preview.
    return refuse(403, 'forbidden', `this endpoint requires one of: ${ACTIVATION_ISSUER_ROLES.join(', ')}`);
  }
  const userId = String(b.userId ?? '').trim();
  if (!userId) return refuse(400, 'invalid_user_id', 'userId must be a valid uuid');
  // activation_issue_scope: a class teacher issues for their own sections'
  // students only — the roster's children, not a colleague's account.
  if (role === 'class_teacher' && !/^demo-(9a|9b|10a)-s\d+$/.test(userId)) {
    return refuse(403, 'not_your_student',
      'you may only issue activation codes for students of your own sections');
  }
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const code = [...bytes].map((x) => ACTIVATION_ALPHABET[x % ACTIVATION_ALPHABET.length]).join('');
  // activation_codes.expires_at defaults to now() + 72 hours.
  return ok({ code, expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() });
}

// ── Annual rollover (finding 46) ────────────────────────────────────────

interface DemoRolloverRow {
  studentId: string; nameBn: string; fromLevel: number; fromSection: string; fromRoll: number;
  action: 'promote' | 'repeat' | 'graduate' | 'blocked';
  toLevel: number | null; toSection: string | null; toRoll: number | null; blockerBn: string | null;
}

/**
 * `app.rollover_preview`, played out on the demo school's three sections.
 *
 * The summary used to be typed beside the rows — "৩ জন আটকে আছে" over a list
 * of one — while the service computes both from the same rows. Here too:
 * the rows are built, and `summary` is counted from them.
 *
 * - নবম ক: eleven go up to দশম ক; one was detained and repeats in নবম ক.
 * - নবম খ: nine go up to দশম খ. Three were detained, and নবম "খ" has not been
 *   opened for next year, so they are blocked — the function's own reason.
 * - দশম ক: the highest class the school teaches, so all eight graduate.
 */
function demoRolloverRows(): DemoRolloverRow[] {
  const rows: DemoRolloverRow[] = [];
  const newRoll = new Map<string, number>();
  const nextRoll = (key: string) => { const n = (newRoll.get(key) ?? 0) + 1; newRoll.set(key, n); return n; };

  NAMES.forEach(([bn], i) => {
    const detained = i === 11;
    rows.push({
      studentId: `demo-9a-s${i + 1}`, nameBn: bn, fromLevel: 9, fromSection: 'ক', fromRoll: i + 1,
      action: detained ? 'repeat' : 'promote',
      toLevel: detained ? 9 : 10, toSection: 'ক', toRoll: nextRoll(detained ? '9|ক' : '10|ক'),
      blockerBn: null,
    });
  });
  const NINE_B = ['রিয়াদ হোসেন', 'লামিয়া খাতুন', 'শাকিল আহমেদ', 'তানজিলা আক্তার', 'নাফিস ইকবাল',
    'সুমি রানী দাস', 'আসিফ মাহমুদ', 'রুমানা পারভীন', 'সাব্বির রহমান', 'ইশরাত জাহান',
    'মাহিন চৌধুরী', 'অর্পিতা সাহা'];
  NINE_B.forEach((bn, i) => {
    const detained = i === 3 || i === 8 || i === 10;
    rows.push({
      studentId: `demo-9b-s${i + 1}`, nameBn: bn, fromLevel: 9, fromSection: 'খ', fromRoll: i + 1,
      action: detained ? 'blocked' : 'promote',
      toLevel: detained ? 9 : 10,
      toSection: detained ? null : 'খ',
      toRoll: detained ? null : nextRoll('10|খ'),
      // format('%s শ্রেণিতে "%s" শাখা নতুন বছরে তৈরি হয়নি', target_level, section)
      blockerBn: detained ? '9 শ্রেণিতে "খ" শাখা নতুন বছরে তৈরি হয়নি' : null,
    });
  });
  const TEN_A = ['ফাহিম মুনতাসির', 'নাদিয়া সুলতানা', 'তৌহিদুল ইসলাম', 'মৌমিতা দে', 'আবির হাসান',
    'সানজিদা ইয়াসমিন', 'রাকিব উদ্দিন', 'প্রিয়াঙ্কা বিশ্বাস'];
  TEN_A.forEach((bn, i) => {
    rows.push({
      studentId: `demo-10a-s${i + 1}`, nameBn: bn, fromLevel: 10, fromSection: 'ক', fromRoll: i + 1,
      action: 'graduate', toLevel: null, toSection: null, toRoll: null, blockerBn: null,
    });
  });
  return rows;
}

function demoRolloverSummary(rows: DemoRolloverRow[]) {
  return {
    considered: rows.length,
    promote: rows.filter((r) => r.action === 'promote').length,
    repeat: rows.filter((r) => r.action === 'repeat').length,
    graduate: rows.filter((r) => r.action === 'graduate').length,
    blocked: rows.filter((r) => r.action === 'blocked').length,
  };
}

/** The plan saved in this preview, if any — `year_rollovers` for the pair. */
let demoRolloverPlan: { id: string; status: 'planned'; planned: ReturnType<typeof demoRolloverSummary> } | null = null;

const ROLLOVER_WRITE_ROLES = ['principal', 'school_owner'];

function demoRollover(init: RequestInit): Response {
  const rows = demoRolloverRows();
  const summary = demoRolloverSummary(rows);
  if (methodOf(init) === 'POST') {
    if (!ROLLOVER_WRITE_ROLES.includes(demoRole())) {
      return refuse(403, 'forbidden', `this endpoint requires one of: ${ROLLOVER_WRITE_ROLES.join(', ')}`);
    }
    const req = bodyOf<{ rolloverId: string; fromYearId: string; toYearId: string }>(init);
    if (req.rolloverId) {
      // app.commit_rollover refuses while anybody is blocked, naming one.
      const sample = rows.find((r) => r.action === 'blocked');
      if (sample) {
        return refuse(409, 'rollover_refused',
          `rollover has ${summary.blocked} blocked student(s); e.g. ${sample.blockerBn}`,
          { hint: 'call app.rollover_preview(from, to) for the full list' });
      }
      return ok({ committed: true, promoted: summary.promote, repeated: summary.repeat,
                  graduated: summary.graduate });
    }
    if (!req.fromYearId || !req.toYearId) return refuse(400, 'bad_request', 'দুইটি শিক্ষাবর্ষ বেছে নিন');
    if (req.fromYearId === req.toYearId) {
      return refuse(400, 'same_year', 'একই বছর থেকে একই বছরে উন্নীত করা যায় না');
    }
    demoRolloverPlan = { id: 'demo-rollover', status: 'planned', planned: summary };
    return ok({ rolloverId: demoRolloverPlan.id, status: demoRolloverPlan.status, summary });
  }
  return ok({
    years: [
      { id: 'demo-year-next', label: '২০২৭', isCurrent: false },
      { id: 'demo-year', label: '২০২৬', isCurrent: true },
    ],
    needsTargetYear: false,
    fromYear: { id: 'demo-year', label: '২০২৬' },
    toYear: { id: 'demo-year-next', label: '২০২৭' },
    summary,
    students: rows,
    existing: demoRolloverPlan
      ? { id: demoRolloverPlan.id, status: demoRolloverPlan.status,
          planned: demoRolloverPlan.planned, actual: null }
      : null,
  });
}

/**
 * The published routine as `role` reads it — GET /rms/timetable, and the grid
 * the printed routine sheet is drawn from, so the sheet and the screen are one.
 */
function demoTimetable(role: string, requestedScope: string | null) {
  // P9-8. The published routine as each reader sees it. The demo's role
  // decides the menu, exactly as the server's `offered()` does — a demo
  // that showed a student the institution would be teaching the wrong
  // thing about the product.
  const admin =['principal', 'school_owner', 'academic_coordinator', 'it_admin']
    .includes(role);
  const scope = requestedScope
    ?? (admin ? 'institution' : role === 'guardian' ? 'student'
        : role === 'student' ? 'student' : 'teacher');
  const menu = admin
    ? [
        { scope: 'institution', labelBn: 'পুরো প্রতিষ্ঠান' },
        { scope: 'section', labelBn: 'শাখা',
          options: [{ id: 'demo-9a', labelBn: 'নবম শ্রেণি — ক' },
                    { id: 'demo-9b', labelBn: 'নবম শ্রেণি — খ' }] },
        { scope: 'teacher', labelBn: 'শিক্ষক',
          options: [{ id: 'demo-teacher', labelBn: 'রফিক ইসলাম' }] },
        { scope: 'room', labelBn: 'কক্ষ ও ল্যাব',
          options: [{ id: 'demo-room-1', labelBn: '১০১ নম্বর কক্ষ' }] },
      ]
    : role === 'guardian'
      ? [{ scope: 'student', labelBn: 'আমার সন্তান',
           options: [{ id: 'demo-user', labelBn: 'সাদিয়া ইসলাম' }] }]
      : role === 'student'
        ? [{ scope: 'student', labelBn: 'আমার রুটিন',
             options: [{ id: 'self', labelBn: 'আমার সাপ্তাহিক ক্লাস' }] }]
        : [{ scope: 'teacher', labelBn: 'আমার রুটিন',
             options: [{ id: 'self', labelBn: 'আমার সাপ্তাহিক ক্লাস' }] },
           { scope: 'section', labelBn: 'আমার শাখা',
             options: [{ id: 'demo-9a', labelBn: 'নবম শ্রেণি — ক' }] }];

  const SUBJ = ['গণিত', 'বাংলা', 'ইংরেজি', 'বিজ্ঞান', 'ধর্ম ও নৈতিক শিক্ষা'];
  const TEACH = ['রফিক ইসলাম', 'সালমা খাতুন', 'কামাল হোসেন'];
  const lessons = [];
  for (const dow of [0, 1, 2, 3, 4]) {
    for (let p2 = 1; p2 <= 6; p2++) {
      // The institution's grid legitimately stacks several sections in
      // one cell; a section's holds one. Same shape, different density.
      const n = scope === 'institution' ? 4 : 1;
      for (let k = 0; k < n; k++) {
        lessons.push({
          routineId: 'demo-routine-live',
          dayOfWeek: dow, periodNo: p2,
          startsAt: `${String(8 + p2).padStart(2, '0')}:00`,
          endsAt: `${String(8 + p2).padStart(2, '0')}:45`,
          subjectBn: SUBJ[(dow + p2 + k) % SUBJ.length],
          teacherBn: TEACH[(p2 + k) % TEACH.length],
          roomBn: `${formatCount(101 + k, 'bn')} নম্বর কক্ষ`,
          sectionLabel: k === 0 ? 'ক' : String.fromCharCode(0x995 + k),
          classBn: 'নবম শ্রেণি',
          isParallel: p2 === 5,
        });
      }
    }
  }
  return {
    ok: true, scope, published: true,
    titleBn: admin && scope === 'institution'
      ? DEMO_TENANTS[demoTenantKey()].branding.nameBn : 'নবম শ্রেণি — ক',
    subtitleBn: 'সাপ্তাহিক প্রকাশিত রুটিন',
    routines: [{ id: 'demo-routine-live', version: 2, shift: 'single',
                 shiftBn: 'একক', nameBn: 'বার্ষিক রুটিন',
                 publishedAt: new Date().toISOString(), yearLabel: '২০২৬' }],
    periods: [1, 2, 3, 4, 5, 6].map((n) => ({
      routineId: 'demo-routine-live', periodNo: n, labelBn: `${n} নম্বর`,
      startsAt: `${String(8 + n).padStart(2, '0')}:00`,
      endsAt: `${String(8 + n).padStart(2, '0')}:45`,
    })),
    lessons,
    counts: scope === 'institution'
      ? { sections: 4, teachers: 3, rooms: 4, classes: 1 }
      : { sections: 1, teachers: 3, rooms: 1, classes: 1 },
    days: [{ dow: 0, bn: 'রবি' }, { dow: 1, bn: 'সোম' }, { dow: 2, bn: 'মঙ্গল' },
           { dow: 3, bn: 'বুধ' }, { dow: 4, bn: 'বৃহস্পতি' }],
    offered: menu,
  };
}

function demoRole(): string {
  const fromUrl = new URLSearchParams(location.search).get('role');
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem('shikhon_demo_role') || 'class_teacher'; }
  catch { return 'class_teacher'; }
}

/** Which demo institution this preview is showing. Defaults to A. */
export function demoTenantKey(search = location.search): 'a' | 'b' {
  const t = new URLSearchParams(search).get('tenant');
  if (t === 'b') return 'b';
  if (t === 'a') return 'a';
  try {
    return localStorage.getItem('shikhon_demo_tenant') === 'b' ? 'b' : 'a';
  } catch {
    return 'a';
  }
}

export class DemoAuth extends Auth {
  constructor() {
    super({ apiBase: '', deviceId: 'demo-device' });
    // Remembered so a reload (the role switcher does a full reload) stays
    // on the same institution instead of snapping back to A.
    try { localStorage.setItem('shikhon_demo_tenant', demoTenantKey()); } catch { /* ignore */ }
  }

  override isLoggedIn(): boolean { return true; }
  override get tenantId(): string { return DEMO_TENANTS[demoTenantKey()].id; }
  // Student-role demo must match the submission rows below, so the
  // "my answer" pre-fill and graded-state branches actually exercise.
  override get userId(): string { return this.role === 'student' ? 'demo-user' : 'demo-teacher'; }
  /**
   * Demo role, switchable via ?role= or the picker in the top bar. The
   * home dashboard is role-aware (app.ts dashboardFor), so without a way
   * to change roles the student and guardian surfaces would be
   * unreachable in a preview — which is exactly the audience most likely
   * to be looking at a demo.
   */
  override get role(): string {
    const fromUrl = new URLSearchParams(location.search).get('role');
    if (fromUrl) {
      try { localStorage.setItem('shikhon_demo_role', fromUrl); } catch { /* ignore */ }
      return fromUrl;
    }
    try { return localStorage.getItem('shikhon_demo_role') || 'class_teacher'; }
    catch { return 'class_teacher'; }
  }
  override get roles(): string[] { return [this.role]; }
  override get displayName(): string {
    const label: Record<string, string> = {
      student: 'রাফি (শিক্ষার্থী)',
      guardian: 'অভিভাবক — রাফির',
      class_teacher: 'ডেমো (শ্রেণি শিক্ষক)',
      principal: 'ডেমো (অধ্যক্ষ)',
      accountant: 'ডেমো (হিসাবরক্ষক)',
      // P1 added it_admin to the demo role picker so the IT-admin sidebar —
      // the one navigation set with no teaching rows in it — is previewable.
      it_admin: 'ডেমো (আইটি অ্যাডমিন)',
    };
    return label[this.role] ?? 'ডেমো (নমুনা তথ্য)';
  }

  override async logout(): Promise<void> {
    // No session to revoke — app.ts falls back to the login view, which
    // shows the login-disabled notice.
  }

  override async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, 'http://demo.internal');

    // Minors 84, 103. Nothing here crosses a network, so every write used to
    // succeed with the device offline: /sync/push answered "applied" and
    // drained the outbox the moment it filled, and the queued count — the
    // offline state a school most needs to see — lasted fourteen
    // milliseconds. Offline, a write fails the way `fetch` fails. Reads keep
    // answering, as the service worker's cache answers them.
    if (methodOf(init) !== 'GET' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new TypeError('Failed to fetch');
    }

    const refused = demoForbidden(url.pathname);
    if (refused) return refused;

    switch (url.pathname) {
      // R-1. Answered locally like every other demo endpoint, and answered
      // for THIS demo institution only — a demo that could hand back the
      // other tenant's branding would be demonstrating the bug the feature
      // exists to prevent.
      case '/api/v1/ops/branding':
      case '/api/v1/ops/brand':
        return ok({ branding: DEMO_TENANTS[demoTenantKey()].branding });

      // ── R-3 ────────────────────────────────────────────────────────
      // The role gate is reproduced, not skipped: a student who navigates
      // to #/institution in the preview gets the same 403 the server would
      // give them. A demo that showed the dashboard to everybody would be
      // teaching that the management screens are open.
      case '/api/v1/ops/dashboard': {
        const showFinance = ['principal', 'school_owner'].includes(demoRole());
        return ok({
          year: { id: 'demo-year', label: '২০২৬' },
          needsSetup: false,
          counts: { students: 1240, teachers: 48, sections: 26, classes: 6 },
          attendanceToday: {
            present: 1102, marked: 1180, percent: 93,
            sessionsTaken: 22, sectionsExpected: 26,
          },
          absentToday: {
            total: 78,
            shown: DEMO_SECTION_F_ROSTER.slice(0, 6).map((s) => ({
              studentId: s.studentId, nameBn: s.nameBn, rollNo: s.rollNo,
              section: 'F', classBn: 'নবম শ্রেণি',
            })),
          },
          upcomingExams: [
            { id: 'demo-exam1', nameBn: 'অর্ধবার্ষিক পরীক্ষা', startsOn: '2026-06-10', status: 'marking' },
          ],
          recentNotices: [
            { id: 'demo-n1', title: 'অভিভাবক সভা', category: 'guardian', publishedAt: '2026-05-02', recipientCount: 860 },
          ],
          pending: {
            sectionsWithoutClassTeacher: 2,
            subjectsWithoutTeacher: 3,
            examsAwaitingPublication: 1,
            studentsWithoutSection: 0,
          },
          finance: showFinance
            ? { invoiced: '1240000.00', collected: '985000.00', outstanding: '255000.00', unpaidCount: 212 }
            : null,
        });
      }

      case '/api/v1/academics/hierarchy': {
        const sectionId = url.searchParams.get('sectionId');
        const studentId = url.searchParams.get('studentId');

        if (studentId) {
          const st = DEMO_SECTION_F_ROSTER.find((r) => r.studentId === studentId)
            ?? DEMO_SECTION_F_ROSTER[0];
          return ok({
            student: {
              id: st.studentId, nameBn: st.nameBn, nameEn: null,
              studentCode: st.studentCode, admissionDate: '2024-01-05',
              lifecycleStatus: 'enrolled', bloodGroup: 'B+', status: 'active',
            },
            current: {
              yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম শ্রেণি',
              groupBn: 'বিজ্ঞান', section: 'F', rollNo: st.rollNo, status: 'active',
            },
            history: [
              { yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম শ্রেণি', groupBn: 'বিজ্ঞান',
                section: 'F', rollNo: st.rollNo, status: 'active', enrolledOn: '2026-01-05', endedOn: null },
              { yearLabel: '২০২৫', levelNo: 8, classBn: 'অষ্টম শ্রেণি', groupBn: 'সাধারণ',
                section: 'খ', rollNo: 12, status: 'promoted', enrolledOn: '2025-01-05', endedOn: '2025-12-20' },
            ],
            guardians: [
              { nameBn: 'মোঃ আব্দুল করিম', relation: 'father', isPrimary: true, canPayFees: true },
              { nameBn: 'রোকসানা বেগম', relation: 'mother', isPrimary: false, canPayFees: false },
            ],
            attendance90d: { present: 74, total: 80 },
          });
        }

        if (sectionId) {
          const sec = DEMO_SECTIONS_SCIENCE.find((x) => x.id === sectionId) ?? DEMO_SECTIONS_SCIENCE[5];
          const isF = sec.name === 'F';
          return ok({
            section: {
              id: sec.id, name: sec.name, shift: sec.shift, capacity: sec.capacity,
              studentCount: sec.studentCount, classId: 'demo-cls-9sci', levelNo: 9,
              classNameBn: 'নবম শ্রেণি', groupBn: 'বিজ্ঞান',
              yearId: 'demo-year', yearLabel: '২০২৬',
            },
            classTeacher: sec.classTeacher
              ? { ...sec.classTeacher, since: '2026-01-05' }
              : null,
            subjectTeachers: (isF ? R3_SUBJECTS : R3_SUBJECTS.slice(0, 4)).map((sub, i) => ({
              assignmentId: `demo-a-${sec.name}-${i}`,
              subject: sub,
              teacher: { id: DEMO_TEACHERS[i % 5].id, nameBn: DEMO_TEACHERS[i % 5].nameBn },
              startedOn: '2026-01-05',
            })),
            unassignedSubjects: isF ? [] : [R3_SUBJECTS[4]],
            roster: isF ? DEMO_SECTION_F_ROSTER : DEMO_SECTION_F_ROSTER.slice(0, sec.studentCount),
            // A replacement that already happened, so the preview shows what
            // migration 041 preserves rather than only describing it.
            history: isF
              ? [{ kind: 'subject_teacher', subjectBn: 'পদার্থবিজ্ঞান', teacherBn: 'জামাল স্যার',
                   startedOn: '2026-01-05', endedOn: '2026-03-15', endReason: 'বদলি হয়েছেন' }]
              : [],
          });
        }

        return ok({
          years: [
            { id: 'demo-year', label: '২০২৬', isCurrent: true },
            { id: 'demo-year-prev', label: '২০২৫', isCurrent: false },
          ],
          year: { id: 'demo-year', label: '২০২৬' },
          classes: [
            {
              levelNo: 9, nameBn: 'নবম শ্রেণি', nameEn: 'Class Nine',
              sectionCount: 8, studentCount: 289,
              groups: [
                { classId: 'demo-cls-9sci', group: 'science', groupBn: 'বিজ্ঞান',
                  sectionCount: 6, studentCount: 226, sections: DEMO_SECTIONS_SCIENCE },
                { classId: 'demo-cls-9hum', group: 'humanities', groupBn: 'মানবিক',
                  sectionCount: 1, studentCount: 34,
                  sections: [{ id: 'demo-sec-hum', name: 'ক', shift: 'morning', capacity: 60,
                               studentCount: 34, classTeacher: { id: 'demo-t3', nameBn: 'হাসান স্যার' },
                               subjectTeacherCount: 4 }] },
                { classId: 'demo-cls-9bus', group: 'business_studies', groupBn: 'ব্যবসায় শিক্ষা',
                  sectionCount: 1, studentCount: 29,
                  sections: [{ id: 'demo-sec-bus', name: 'ক', shift: 'morning', capacity: 60,
                               studentCount: 29, classTeacher: null, subjectTeacherCount: 3 }] },
              ],
            },
            {
              levelNo: 10, nameBn: 'দশম শ্রেণি', nameEn: 'Class Ten',
              sectionCount: 2, studentCount: 71,
              groups: [
                { classId: 'demo-cls-10sci', group: 'science', groupBn: 'বিজ্ঞান',
                  sectionCount: 2, studentCount: 71,
                  sections: [
                    { id: 'demo-sec-10a', name: 'ক', shift: 'morning', capacity: 60, studentCount: 36,
                      classTeacher: { id: 'demo-t4', nameBn: 'নাঈম স্যার' }, subjectTeacherCount: 5 },
                    { id: 'demo-sec-10b', name: 'খ', shift: 'morning', capacity: 60, studentCount: 35,
                      classTeacher: { id: 'demo-t5', nameBn: 'শুভ স্যার' }, subjectTeacherCount: 5 },
                  ] },
              ],
            },
          ],
        });
      }

      case '/api/v1/ops/assign': {
        if (init.method === 'POST') {
          const req = JSON.parse(String(init.body ?? '{}')) as
            { teacherId?: string; reason?: string; effectiveDate?: string };
          const t = DEMO_TEACHERS.find((x) => x.id === req.teacherId) ?? DEMO_TEACHERS[0];
          return ok({
            assignmentId: 'demo-new-assignment',
            replaced: req.reason ? { teacherId: 'demo-t1', nameBn: 'রহিম স্যার' } : null,
            unchanged: false,
            teacher: { id: t.id, nameBn: t.nameBn },
            effectiveDate: req.effectiveDate ?? '2026-05-01',
          });
        }
        return ok({
          subjects: R3_SUBJECTS.map((sub, i) => ({
            id: sub.id, nameBn: sub.nameBn,
            assigned: { id: DEMO_TEACHERS[i % 5].id, nameBn: DEMO_TEACHERS[i % 5].nameBn },
          })),
          teachers: DEMO_TEACHERS,
        });
      }

      case '/api/v1/ops/enrol': {
        const req = JSON.parse(String(init.body ?? '{}')) as
          { studentIds?: string[]; dryRun?: boolean };
        const ids = req.studentIds ?? [];
        return ok({
          section: { id: 'demo-sec-A', name: 'A', classBn: 'নবম শ্রেণি', group: 'science',
                     yearLabel: '২০২৬', capacity: 60, currentCount: 38,
                     countAfter: 38 + ids.length },
          moving: ids.map((id, i) => ({
            studentId: id,
            nameBn: DEMO_SECTION_F_ROSTER.find((r) => r.studentId === id)?.nameBn ?? id,
            from: { sectionId: 'demo-sec-F', section: 'F', classBn: 'নবম শ্রেণি', rollNo: i + 1 },
            toRollNo: 39 + i,
            isNewEnrolment: false,
          })),
          alreadyInSection: [], notFound: [],
          overCapacity: 38 + ids.length > 60,
          committed: req.dryRun === false,
        });
      }

      case '/api/v1/ops/rollover':
        // Finding 46: the summary is counted from the rows, as the service does.
        return demoRollover(init);

      case '/api/v1/ops/settings': {
        if (init.method === 'PUT') {
          const req = JSON.parse(String(init.body ?? '{}')) as
            { sms?: { noticeMaxChars?: number } };
          return ok({ sms: { noticeMaxChars: req.sms?.noticeMaxChars ?? 180,
                             default: 180, min: 70, max: 480, charsPerSegment: 70 } });
        }
        return ok({ sms: { noticeMaxChars: 180, default: 180, min: 70, max: 480, charsPerSegment: 70 } });
      }

      case '/api/v1/ops/users':
        // Minors 70, 95: the filter, the search and every write now reach the
        // list the screen reloads, as they reach `users` on the server.
        return demoUsersHandler(url, init, this.userId);

      case '/api/v1/academics/publish': {
        if (init.method === 'POST') {
          return ok({ ok: true, examId: 'demo-exam1', marksGraded: 1180,
                      resultsPublished: 236, notified: 472 });
        }
        return ok({
          exams: [
            {
              examId: 'demo-exam1', examNameBn: 'অর্ধবার্ষিক পরীক্ষা', status: 'marking',
              startsOn: '2026-06-10', endsOn: '2026-06-20',
              subjects: R3_SUBJECTS.map((sub, i) => ({
                examSubjectId: `demo-es${i}`, subjectBn: sub.nameBn, sectionName: 'F',
                enrolled: 40, marked: i === 4 ? 31 : 40,
              })),
            },
            {
              examId: 'demo-exam0', examNameBn: 'প্রথম সাময়িক পরীক্ষা', status: 'published',
              startsOn: '2026-03-02', endsOn: '2026-03-12',
              subjects: R3_SUBJECTS.slice(0, 3).map((sub, i) => ({
                examSubjectId: `demo-es0${i}`, subjectBn: sub.nameBn, sectionName: 'F',
                enrolled: 40, marked: 40,
              })),
            },
          ],
        });
      }

      case '/api/v1/finance/generate':
        return ok({ ok: true, billingPeriod: '2026-05', invoicesCreated: 236, notified: 198 });

      // ── R-4 ────────────────────────────────────────────────────────
      case '/api/v1/ops/calendar': {
        const tenant = DEMO_CALENDAR[demoTenantKey()];
        if (init.method === 'POST' || init.method === 'PATCH') {
          const req = JSON.parse(String(init.body ?? '{}')) as
            { titleBn?: string; notify?: boolean };
          return ok({ id: 'demo-cal-new', titleBn: req.titleBn,
                      notified: req.notify ? 1240 : 0 });
        }
        if (init.method === 'DELETE') return ok({ id: 'demo-cal-1', deleted: true });

        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        const kind = url.searchParams.get('kind') ?? '';
        const entries = tenant.entries
          .filter((e) => (!from || e.day >= from) && (!to || e.day <= to))
          .filter((e) => !kind || e.kind === kind);
        return ok({
          range: { from, to },
          weekendDays: tenant.weekendDays,
          shifts: demoTenantKey() === 'a' ? ['morning', 'day'] : ['single'],
          years: [
            { id: 'demo-year', label: '২০২৬', isCurrent: true,
              startsOn: '2026-01-01', endsOn: '2026-12-31' },
          ],
          currentYearId: 'demo-year',
          entries,
        });
      }

      // ── R-3 completion pass ────────────────────────────────────────
      case '/api/v1/ops/structure': {
        // B-6. The rename. Answers the same shapes the endpoint does, INCLUDING
        // the capacity refusal — a demo that only shows the happy path teaches
        // an office that the form always says yes.
        if (init.method === 'PATCH') {
          const req = JSON.parse(String(init.body ?? '{}')) as {
            kind?: string; id?: string; nameBn?: string; name?: string; capacity?: number;
          };
          if (req.kind === 'class') {
            return ok({ id: req.id, kind: 'class', nameBn: req.nameBn });
          }
          if (typeof req.capacity === 'number' && req.capacity < DEMO_SECTION_ENROLLED) {
            return new Response(JSON.stringify({
              error: 'capacity_below_enrolled',
              // Bangla digits, exactly as the real endpoint renders it. A demo
              // that prints 40 where production prints ৪০ is showing a
              // different product.
              message: `এই শাখায় এখন ${formatCount(DEMO_SECTION_ENROLLED, 'bn')} জন শিক্ষার্থী আছে — `
                + 'ধারণক্ষমতা তার কম দেওয়া যাবে না',
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          return ok({ id: req.id, kind: 'section', name: req.name, capacity: req.capacity });
        }
        if (init.method === 'POST') {
          const req = JSON.parse(String(init.body ?? '{}')) as {
            kind?: string; label?: string; nameBn?: string; name?: string;
          };
          if (req.kind === 'year')  return ok({ id: 'demo-new-year', kind: 'year', label: req.label });
          if (req.kind === 'class') return ok({ id: 'demo-new-class', kind: 'class', nameBn: req.nameBn });
          return ok({ id: 'demo-new-section', kind: 'section', name: req.name,
                      classNameBn: 'নবম শ্রেণি', group: 'science' });
        }
        return ok({
          defaultStream: 'bangla_medium',
          years: [
            { id: 'demo-year', label: '২০২৬', isCurrent: true },
            { id: 'demo-year-prev', label: '২০২৫', isCurrent: false },
          ],
          classes: [
            { id: 'demo-cls-9sci', levelNo: 9, nameBn: 'নবম শ্রেণি', group: 'science' },
            { id: 'demo-cls-9hum', levelNo: 9, nameBn: 'নবম শ্রেণি', group: 'humanities' },
            { id: 'demo-cls-10sci', levelNo: 10, nameBn: 'দশম শ্রেণি', group: 'science' },
          ],
          streams: ['bangla_medium', 'english_version', 'english_medium', 'madrasah', 'technical'],
          groups: ['none', 'science', 'humanities', 'business_studies', 'vocational', 'general'],
          shifts: ['morning', 'day', 'evening', 'single'],
        });
      }

      case '/api/v1/ops/guardians': {
        // B-7. Ending a relationship. The demo answers the refusal too — the
        // last contactable guardian of a student with no phone of their own —
        // because a preview that only shows the happy path teaches an office
        // that the button always works.
        if (init.method === 'DELETE') {
          const req = JSON.parse(String(init.body ?? '{}')) as
            { guardianId?: string; reason?: string };
          if (!(req.reason ?? '').trim()) {
            return new Response(JSON.stringify({
              error: 'reason_required', message: 'কেন সম্পর্ক শেষ হচ্ছে তা লিখুন',
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          if (req.guardianId === 'demo-g1') {
            return new Response(JSON.stringify({
              error: 'last_contactable_guardian',
              message: 'এই শিক্ষার্থীর নিজের ফোন বা ইমেইল নেই, আর ইনিই একমাত্র যোগাযোগযোগ্য '
                + 'অভিভাবক। আগে অন্য একজন অভিভাবক যুক্ত করুন, তারপর এই সম্পর্কটি শেষ করুন।',
            }), { status: 409, headers: { 'Content-Type': 'application/json' } });
          }
          return ok({ studentId: 'demo-stu-1', guardianId: req.guardianId,
                      revokedAt: new Date().toISOString(),
                      wasPrimary: false, needsNewPrimary: false });
        }
        if (init.method === 'POST') {
          const req = JSON.parse(String(init.body ?? '{}')) as { guardianId?: string; phone?: string };
          // The duplicate-guardian case, reproduced: this number is already
          // in the demo school, so a "create" links the existing person.
          const reused = !req.guardianId && (req.phone ?? '').includes('01700000011');
          return ok({ linkId: 'demo-link-new', guardianId: req.guardianId ?? 'demo-g1',
                      created: !req.guardianId && !reused, reusedExisting: reused });
        }
        if (init.method === 'PATCH') {
          const req = JSON.parse(String(init.body ?? '{}')) as { canPayFees?: boolean };
          demoGuardianPays = req.canPayFees ?? demoGuardianPays;
          return ok({ linkId: 'demo-link-1', guardianId: 'demo-g1', nameBn: 'মোঃ আব্দুল করিম',
                      relation: 'father', isPrimary: true, receivesSms: true,
                      canPayFees: demoGuardianPays,
                      feeNoticesChanged: req.canPayFees !== undefined });
        }
        if (url.searchParams.get('q')) {
          return ok({ candidates: [
            { id: 'demo-g1', nameBn: 'মোঃ আব্দুল করিম', phone: '+8801700000011', wardCount: 2 },
            { id: 'demo-g3', nameBn: 'করিমা বেগম', phone: '+8801700000013', wardCount: 0 },
          ] });
        }
        // The server withholds the phone from anyone who may not edit it;
        // the demo must not be the one place a teacher sees the school's
        // contact list.
        const mayEdit = ['principal', 'school_owner', 'it_admin'].includes(demoRole());
        return ok({
          student: { id: url.searchParams.get('studentId') ?? 'demo-s1', nameBn: 'শিক্ষার্থী ১' },
          guardians: [
            { linkId: 'demo-link-1', guardianId: 'demo-g1', nameBn: 'মোঃ আব্দুল করিম',
              phone: mayEdit ? '+8801700000011' : null, relation: 'father', isPrimary: true,
              receivesSms: true, canPayFees: demoGuardianPays, otherWards: 2 },
            { linkId: 'demo-link-2', guardianId: 'demo-g2', nameBn: 'রোকসানা বেগম',
              phone: mayEdit ? '+8801700000012' : null, relation: 'mother', isPrimary: false,
              receivesSms: true, canPayFees: false, otherWards: 0 },
          ],
        });
      }

      case '/api/v1/ops/audit': {
        const all = DEMO_AUDIT;
        const action = url.searchParams.get('action') ?? '';
        const entries = action ? all.filter((a) => a.action === action) : all;
        return ok({
          entries,
          hasMore: false,
          offset: 0,
          pageSize: 50,
          facets: {
            actions: [...new Set(all.map((a) => a.action))].map((v) => ({
              value: v, count: all.filter((a) => a.action === v).length,
            })),
            entityTypes: [...new Set(all.map((a) => a.entityType))].map((v) => ({
              value: v as string, count: all.filter((a) => a.entityType === v).length,
            })),
            actors: [{ id: 'demo-p1', nameBn: 'প্রধান শিক্ষক', count: all.length }],
          },
        });
      }

      // R-2. The inbox differs by ROLE, because that is the whole point: a
      // student must not see the staff-only notice. In the real product the
      // difference comes from which receipts exist; here it is filtered by
      // the same rule so the demo does not teach a falsehood.
      case '/api/v1/ops/inbox': {
        const mine = DEMO_NOTICES.filter((n) => n.roles.includes(demoRole()));
        if (url.searchParams.get('limit') === '1') {
          return ok({ unread: mine.filter((n) => !demoRead.has(n.noticeId)).length, notices: [] });
        }
        return ok({
          unread: mine.filter((n) => !demoRead.has(n.noticeId)).length,
          notices: mine.map((n) => ({
            receiptId: `r-${n.noticeId}`,
            noticeId: n.noticeId,
            title: n.title,
            body: n.body,
            category: n.category,
            deliveredAt: n.deliveredAt,
            readAt: demoRead.has(n.noticeId) ? new Date().toISOString() : null,
            aboutStudent: n.aboutStudent ?? null,
          })),
        });
      }

      case '/api/v1/ops/notices':
        // No request leaves the device, so a published notice reaches nobody
        // real — but the estimate and the reply have the service's shape.
        return demoNotices(url, init);

      case '/api/v1/academics/sections':
        return ok({ sections: SECTIONS });

      case '/api/v1/academics/roster':
        return ok({ roster: rosterFor(url.searchParams.get('sectionId') ?? 'demo') });

      // Two different questions share this URL, and the demo answered both
      // with the marks feed. `?yearId=` is the office's exam register —
      // `{canManage, examTypes, exams[]}` with paper and mark counts — and
      // `?sectionId=` is the per-section feed the marks screen reads.
      //
      // It was also METHOD-BLIND: a POST returned 200 and the exam list, so
      // the exam-management screen would have reported "তৈরি করা হয়েছে।" in
      // the public preview while creating nothing. /demo is prospect-facing,
      // and a fake success there is a claim about the product.
      case '/api/v1/academics/exams': {
        if (init.method === 'POST' || init.method === 'PATCH') {
          return new Response(JSON.stringify({
            error: 'demo_read_only',
            message: 'এটি প্রদর্শনী সংস্করণ — এখানে সত্যিকারের পরীক্ষা তৈরি হয় না।',
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.searchParams.get('yearId')) {
          return ok({
            canManage: ['principal', 'school_owner', 'academic_coordinator', 'dept_head']
              .includes(demoRole()),
            examTypes: ['class_test', 'monthly', 'half_yearly', 'pre_test',
                        'test', 'annual', 'model', 'board'],
            exams: DEMO_EXAM_REGISTER,
          });
        }
        return ok({ exams: DEMO_EXAMS });
      }

      case '/api/v1/academics/marks':
        return ok(demoMarks());

      case '/api/v1/academics/assignments': {
        // Finding 10: a grade is a POST here, and it was answered with the
        // list — 200 with no `ok`, so every mark read "সংরক্ষণ করা যায়নি।".
        if (methodOf(init) === 'POST') return demoAssignmentsWrite(init);
        const aid = url.searchParams.get('assignmentId');
        if (aid) return ok(demoAssignmentDetail(aid));
        return ok(demoAssignmentList());
      }

      case '/api/v1/academics/attendance':
        return ok({ studentId: 'demo-s1', months: 6, ...DEMO_ATTENDANCE });

      case '/api/v1/academics/subjects':
        // DEMO_SUBJECTS, not R3_SUBJECTS. The latter is the teacher's bare
        // {id, nameBn, nameEn} list for the subject-teacher panel and carries
        // no chapter counts, so the student's subject cards rendered
        // "undefinedটির মধ্যে undefinedটি অধ্যায় শেষ" — in the visible text and
        // in the progress bar's accessible name. Found by P4's sweep for
        // `undefined` in aria-labels; /demo is a public surface, so this was
        // the first thing a prospective school would have read.
        return ok({ studentId: 'demo-s1', subjects: DEMO_SUBJECTS });

      case '/api/v1/academics/next':
        return ok({ suggestions: DEMO_NEXT });

      case '/api/v1/academics/practice': {
        // The acceleration questions belong to the motion lesson they test,
        // not to every topic of every subject.
        const topicId = url.searchParams.get('topicId') ?? 'demo-l-3';
        return ok({
          topicId,
          questions: topicId === 'demo-l-3' || topicId === 'demo-l-4' ? DEMO_PRACTICE : [],
        });
      }

      case '/api/v1/academics/results': {
        // `studentId || claims.sub`, as the service reads it. The results are
        // Rafi's: the student preview IS Rafi, and a guardian asks by id. A
        // teacher asking for their own gets none, rather than an unnamed
        // child's mark sheet; Tahiya has no published result yet, which is
        // what her guardian panel says.
        const asked = url.searchParams.get('studentId');
        const who = asked || (demoRole() === 'student' ? 'demo-s1' : 'demo-self');
        const rafi = ['demo-s1', 'demo-user', 'demo-stu-11'].includes(who);
        return ok({ studentId: asked || 'demo-s1', results: rafi ? DEMO_RESULTS : [] });
      }

      case '/api/v1/academics/ward': {
        // §9.1's guardian home. The real endpoint bundles everything the
        // wireframe draws in one round trip, so the demo stub does too —
        // splitting the ward list from the per-student payload would let
        // a bug live where the two responses disagree and only prod
        // finds it. The switcher is offered even when there is only one
        // ward, deliberately: §9.1 calls the switcher "the single most-
        // used control", and a guardian with two children is who this
        // screen is really for.
        const WARDS = DEMO_WARDS;
        const wanted = url.searchParams.get('studentId');
        if (!wanted) return ok({ wards: WARDS, student: null });
        const ward = WARDS.find((w) => w.studentId === wanted);
        if (!ward) return new Response(
          JSON.stringify({ error: 'student_not_found' }),
          { status: 404, headers: { 'content-type': 'application/json' } });
        const HOMES: Record<string, {
          attendance: { todayStatus: string | null; monthPercent: number | null;
                        present: number; absent: number; late: number;
                        halfDay: number; excused: number };
          fees: { outstanding: number; earliestDue: string | null; overdueCount: number };
          result: { examNameBn: string; gpa: number | null;
                    rankInSection: number | null; sectionSize: number | null } | null;
        }> = {
          'demo-s1': {
            attendance: { todayStatus: 'present', monthPercent: 92,
                          present: 18, absent: 1, late: 1, halfDay: 0, excused: 0 },
            // Counted from the bills and read from the mark sheet, not typed
            // beside them: the panel said ৳1,500 and GPA ৪.৪২ over a fee
            // screen of ৳1,250 and a latest result of ৪.৭২.
            fees: demoWardFees('demo-s1'),
            result: { examNameBn: DEMO_RESULTS[0].examNameBn, gpa: Number(DEMO_RESULTS[0].gpa),
                      rankInSection: DEMO_RESULTS[0].rankInSection, sectionSize: 52 },
          },
          'demo-s2': {
            // Deliberately a second child in a very different state —
            // an absence today, a bill overdue, no result yet — so the
            // ward-switch actually changes the screen.
            attendance: { todayStatus: 'absent', monthPercent: 78,
                          present: 14, absent: 3, late: 2, halfDay: 1, excused: 0 },
            fees: demoWardFees('demo-s2'),
            result: null,
          },
        };
        return ok({ wards: WARDS, student: { ...ward, ...HOMES[wanted] } });
      }

      case '/api/v1/academics/chapters':
        return ok({ chapters: DEMO_CHAPTERS });

      case '/api/v1/academics/topics': {
        const topicId = url.searchParams.get('topicId');
        if (topicId) return ok(demoTopic(topicId));
        const chapterId = url.searchParams.get('chapterId') ?? 'demo-ch-1';
        return ok({ chapterId, topics: demoTopicsOf(chapterId) });
      }

      // P5. The ledger fixture lives HERE now, gated by the map above.
      // It used to live inside `ledger-view` as a `DEMO` constant the screen
      // fell back to on a 403 — so a refused coordinator was shown a complete
      // set of plausible taka figures labelled "নমুনা". Sample data belongs in
      // the demo, where it is gated and where nothing calls it production.
      case '/api/v1/finance/ledger':
        return ok(DEMO_LEDGER);

      case '/api/v1/finance/invoices':
        return ok({ invoices: demoInvoicesVisible(url.searchParams.get('studentId')) });

      case '/api/v1/finance/receipts':
        return demoReceipts(url);

      case '/api/v1/finance/payments':
        return demoPayments(url, init);

      case '/api/v1/finance/feestructures':
        return demoFeeStructuresHandler(url, init);

      // B-15. A student's own day. Guardians reach it with ?studentId=, and
      // the demo answers the same fixture for either child — the real
      // endpoint scopes it through app.can_see_student, which no local
      // fixture can imitate and which p4-privacy/b15 test against a database.
      case '/api/v1/academics/myroutine':
        return ok({
          date: url.searchParams.get('date') ?? todayIso(),
          studentId: url.searchParams.get('studentId') ?? 'demo-user',
          slots: DEMO_STUDENT_DAY,
        });

      case '/api/v1/rms/routine': {
        if (url.searchParams.get('scope') === 'week') {
          const weekStart = url.searchParams.get('weekStart') ?? todayIso();
          return ok({ scope: 'week', weekStart, days: weekDays(weekStart) });
        }
        const date = url.searchParams.get('date') ?? todayIso();
        return ok({ scope: 'day', date, slots: daySlots(date) });
      }

      case '/api/v1/academics/classperf': {
        // §7.5. Shaped to exercise every branch the screen has: a component
        // under 50 so the low tone renders, two weak questions in one chapter
        // so the re-teach hint fires, and an attention list where one student
        // carries a single signal and another carries two — the case where a
        // severity ranking would be most tempting and is most wrong.
        if (!url.searchParams.get('examSubjectId')) {
          return ok({ choices: DEMO_PERF_CHOICES, analysis: null });
        }
        return ok({
          choices: DEMO_PERF_CHOICES,
          analysis: {
            header: { examSubjectId: 'es-1', label: 'নবম-ক · পদার্থবিজ্ঞান · ১ম সাময়িক' },
            coverage: { marked: 32, enrolled: 35, absent: 2 },
            components: [
              { key: 'mcq', labelBn: 'বহুনির্বাচনি', max: 25, average: 11.2, percent: 45 },
              { key: 'cq', labelBn: 'সৃজনশীল', max: 50, average: 33.5, percent: 67 },
              { key: 'practical', labelBn: 'ব্যবহারিক', max: 25, average: 19.0, percent: 76 },
            ],
            practice: {
              source: 'practice',
              questions: [
                { questionNo: 7, kind: 'mcq', stemBn: 'শব্দের বেগ কোন মাধ্যমে সবচেয়ে বেশি?',
                  chapterBn: 'অধ্যায় ৯: তরঙ্গ ও শব্দ', attempts: 28, wrongPercent: 72 },
                { questionNo: 12, kind: 'mcq', stemBn: 'তরঙ্গদৈর্ঘ্য ও কম্পাঙ্কের সম্পর্ক কী?',
                  chapterBn: 'অধ্যায় ৯: তরঙ্গ ও শব্দ', attempts: 26, wrongPercent: 58 },
                { questionNo: 4, kind: 'numeric', stemBn: '১২ মি/সে বেগে চলা বস্তুর গতিশক্তি নির্ণয় করো।',
                  chapterBn: 'অধ্যায় ৫: কাজ ও শক্তি', attempts: 24, wrongPercent: 51 },
              ],
              reteach: { chapterBn: 'অধ্যায় ৯: তরঙ্গ ও শব্দ', questionCount: 2 },
            },
            attention: [
              { studentId: 'demo-s4', nameBn: 'আনিকা রহমান', rollNo: 4,
                signals: ['গত ৩০ দিনে হাজিরা ৭২%', 'গত পরীক্ষার চেয়ে নম্বর ১৮% কম'] },
              { studentId: 'demo-s9', nameBn: 'তানভীর হোসেন', rollNo: 9,
                signals: ['টানা ৪ দিন অনুপস্থিত'] },
            ],
            thresholds: { attendanceFloorPercent: 80, streakDays: 3, markDropPoints: 15, windowDays: 30 },
          },
        });
      }

      case '/api/v1/academics/subjectchoice': {
        // §10.3. The demo student holds the science-group compulsories and
        // has already chosen Islam + higher maths, so the screen opens on a
        // real state rather than a blank one, and changing either choice
        // exercises the mandatory regeneration warning.
        if (init.method === 'POST') {
          const req = JSON.parse(String(init.body ?? '{}')) as { optionalSubjectId?: string | null };
          return ok({ ok: true, subjectCount: req.optionalSubjectId ? 9 : 8, invalidated: ['routine', 'content'] });
        }
        return ok({
          student: {
            // Roll 1, matching the demo roster's first student: the picker and
            // the header have to describe the same child or the demo teaches a
            // contradiction on its very first screen.
            id: 'demo-s1', nameBn: 'আরিফুল ইসলাম', rollNo: 1,
            classBn: 'নবম শ্রেণি', sectionName: 'ক', groupCode: 'science',
          },
          hasTemplate: true,
          derived: [
            { subjectId: 'sub-bn', nameBn: 'বাংলা', requirementType: 'compulsory' },
            { subjectId: 'sub-en', nameBn: 'ইংরেজি', requirementType: 'compulsory' },
            { subjectId: 'sub-ma', nameBn: 'গণিত', requirementType: 'compulsory' },
            { subjectId: 'sub-ph', nameBn: 'পদার্থবিজ্ঞান', requirementType: 'group_compulsory' },
            { subjectId: 'sub-ch', nameBn: 'রসায়ন', requirementType: 'group_compulsory' },
            { subjectId: 'sub-bi', nameBn: 'জীববিজ্ঞান', requirementType: 'group_compulsory' },
          ],
          religionOptions: [
            { subjectId: 'sub-isl', nameBn: 'ইসলাম ও নৈতিক শিক্ষা', variant: 'islam' },
            { subjectId: 'sub-hin', nameBn: 'হিন্দুধর্ম ও নৈতিক শিক্ষা', variant: 'hindu' },
            { subjectId: 'sub-bud', nameBn: 'বৌদ্ধধর্ম ও নৈতিক শিক্ষা', variant: 'buddhist' },
            { subjectId: 'sub-chr', nameBn: 'খ্রিস্টধর্ম ও নৈতিক শিক্ষা', variant: 'christian' },
          ],
          optionalOptions: [
            { subjectId: 'sub-hma', nameBn: 'উচ্চতর গণিত' },
            { subjectId: 'sub-agr', nameBn: 'কৃষিশিক্ষা' },
            { subjectId: 'sub-hom', nameBn: 'গার্হস্থ্য বিজ্ঞান' },
          ],
          current: {
            religionVariant: 'islam',
            religionSubjectId: 'sub-isl',
            optionalSubjectId: 'sub-hma',
          },
        });
      }

      case '/api/v1/rms/timetable':
        // `this.role`, not a fresh DemoAuth: constructing one re-reads
        // `location.search`, so every caller got whichever role the PAGE URL
        // named rather than the one asking.
        return ok(demoTimetable(this.role, url.searchParams.get('scope')));

      case '/api/v1/rms/publish': {
        // P9-7's review. The GET is demonstrable — a summary of the demo's
        // fixed school is a true summary of it. The POST is not: publishing's
        // visible effect is the card returning as প্রকাশিত on the next read,
        // and this school is a constant, so ok({ok:true}) would be the fake
        // success /demo exists not to produce.
        if (init.method === 'POST') {
          return new Response(JSON.stringify({
            error: 'demo_read_only',
            message: 'এটি প্রদর্শনী সংস্করণ — এখানে সত্যিকারের রুটিন প্রকাশ করা যায় না।',
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return ok({
          ok: true,
          // The school whose demo this IS. Hard-coding one name showed
          // tenant A's on tenant B's screen — the demo has two institutions
          // precisely so that kind of leak is visible.
          tenantNameBn: DEMO_TENANTS[demoTenantKey()].branding.nameBn,
          yearLabel: '২০২৬',
          routines: [{
            routineId: 'demo-routine-1', status: 'draft', statusBn: 'খসড়া',
            version: 1, shift: 'single', shiftBn: 'একক',
            nameBn: 'বার্ষিক রুটিন', yearLabel: '২০২৬',
            slots: 560, sections: 20, teachers: 23, pinned: 2,
            hardConflicts: 0, softViolations: 12, unplacedDemands: 2,
            lastModified: new Date().toISOString(), fingerprint: '560:560',
            publishedAt: null, publishedByBn: null, supersedes: null,
            blockers: [],
            warnings: [{ code: 'unplaced',
                         messageBn: '২টি বিষয়ের কিছু পিরিয়ড বসানো যায়নি।' }],
            canPublish: true,
            // Composed by the server in the real thing, so the demo has to
            // supply them too — a screen that renders the server's sentences
            // shows nothing when they are absent.
            verdictBn: 'এই রুটিন প্রকাশ করা যাবে।',
            consequenceBn: [
              'একক শিফটের ৫৬০টি ক্লাস আজ থেকে সবার রুটিনে দেখা যাবে — '
              + 'শিক্ষক, শিক্ষার্থী ও অভিভাবক সবাই।',
              'মেনে নেওয়া হচ্ছে: ২টি বিষয়ের কিছু পিরিয়ড বসানো যায়নি।',
              'প্রকাশের পর এই রুটিন সরাসরি বদলানো যাবে না — বদলাতে হলে নতুন '
              + 'খসড়া তৈরি করতে হবে।',
            ],
          }],
        });
      }

      case '/api/v1/rms/editor': {
        // §8.1's grid. The demo carries a deliberate mix: an unfilled cell, a
        // parallel religion block, a double practical, and a pinned slot —
        // the four states the editor has to render differently. Moves are
        // answered by the same conflict shape the real endpoint returns, so
        // the refusal path is demonstrable without a database.
        if (init.method === 'POST') {
          const req = JSON.parse(String(init.body ?? '{}')) as { action?: string; periodNo?: number };
          // A4's authoring actions write rows; this grid is a constant, so
          // there is nothing for them to write to. Answering ok({ok:true})
          // would make the preview claim it had placed a lesson and then show
          // the same fixed grid — the exact fake success /demo must never
          // produce. `move` and `publish` stay demonstrable because their
          // whole visible effect is the response.
          if (req.action === 'create-routine' || req.action === 'place'
            || req.action === 'assign' || req.action === 'remove') {
            return new Response(JSON.stringify({
              error: 'demo_read_only',
              message: 'এটি প্রদর্শনী সংস্করণ — এখানে সত্যিকারের রুটিন সংরক্ষণ হয় না।',
            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
          }
          if (req.action === 'publish') return ok({ ok: true, slots: 1, warnings: [] });
          // Period 2 is where the demo's Rafiq is already teaching 9-খ, so
          // moving onto it shows the named refusal rather than a shrug.
          if (req.periodNo === 2) {
            return new Response(JSON.stringify({
              error: 'teacher_busy',
              message: 'রফিক ইসলাম তখন নবম-খ-তে গণিত পড়াচ্ছেন।',
              conflict: { subjectBn: 'গণিত', teacherName: 'রফিক ইসলাম', sectionLabel: 'নবম-খ' },
            }), { status: 409, headers: { 'content-type': 'application/json' } });
          }
          return ok({ ok: true, slotId: 'demo-slot-1' });
        }
        const mk = (id: string, dow: number, periodNo: number, subject: string,
                    teacher: string | null, room: string | null,
                    extra: Record<string, unknown> = {}) => ({
          id, dayOfWeek: dow, periodNo, subjectBn: subject, teacherName: teacher,
          roomName: room, isDouble: false, doubleGroupId: null, parallelPool: null,
          isPinned: false, rowVersion: 1, ...extra,
        });
        return ok({
          sectionId: 'demo-sec-1',
          // The teaching week the real endpoint derives from
          // tenants.weekend_days. Supplied here so the preview draws the same
          // five columns rather than falling back to a constant.
          days: [
            { dow: 0, bn: 'রবি' }, { dow: 1, bn: 'সোম' }, { dow: 2, bn: 'মঙ্গল' },
            { dow: 3, bn: 'বুধ' }, { dow: 4, bn: 'বৃহঃ' },
          ],
          subjects: [
            { id: 'demo-sub-ban', nameBn: 'বাংলা', periodsPerWeek: 6, doublePeriodsPerWeek: 0 },
            { id: 'demo-sub-mat', nameBn: 'গণিত', periodsPerWeek: 6, doublePeriodsPerWeek: 0 },
          ],
          teachers: [
            { subjectId: 'demo-sub-ban', id: 'demo-t-1', nameBn: 'রফিক ইসলাম' },
            { subjectId: 'demo-sub-mat', id: 'demo-t-1', nameBn: 'রফিক ইসলাম' },
          ],
          rooms: [{ id: 'demo-room-1', label: 'কক্ষ ২০১', capacity: 60 }],
          routine: {
            id: 'demo-routine-1', nameBn: 'নিয়মিত রুটিন', shift: 'morning',
            status: 'draft', version: 2, publishedAt: null, editable: true,
            sectionLabel: 'নবম-ক',
          },
          periods: [
            { periodNo: 1, labelBn: 'পিরিয়ড ১', startsAt: '09:00', endsAt: '09:40', kind: 'teaching' },
            { periodNo: 2, labelBn: 'পিরিয়ড ২', startsAt: '09:45', endsAt: '10:25', kind: 'teaching' },
            { periodNo: 3, labelBn: 'বিরতি', startsAt: '10:25', endsAt: '10:50', kind: 'break' },
            { periodNo: 4, labelBn: 'পিরিয়ড ৩', startsAt: '10:50', endsAt: '11:30', kind: 'teaching' },
            { periodNo: 5, labelBn: 'পিরিয়ড ৪', startsAt: '11:35', endsAt: '12:15', kind: 'teaching' },
          ],
          slots: [
            mk('demo-slot-1', 0, 1, 'গণিত', 'রফিক ইসলাম', '১০৩'),
            mk('demo-slot-2', 1, 1, 'বাংলা', 'সালমা খাতুন', '১০৩'),
            mk('demo-slot-3', 2, 1, 'গণিত', 'রফিক ইসলাম', '১০৩'),
            mk('demo-slot-4', 3, 1, 'ইংরেজি', 'করিম উদ্দিন', '১০৩'),
            mk('demo-slot-5', 4, 1, 'পদার্থবিজ্ঞান', 'নাসরিন আক্তার', '১০৩'),
            mk('demo-slot-6', 0, 2, 'ধর্ম শিক্ষা', 'একাধিক', '৩টি কক্ষ', { parallelPool: 'religion' }),
            mk('demo-slot-7', 1, 2, 'রসায়ন', 'আমিনুল হক', '২০১'),
            mk('demo-slot-8', 2, 2, 'জীববিজ্ঞান', 'শিরিন আক্তার', '১০৩', { isPinned: true }),
            mk('demo-slot-9', 0, 4, 'পদার্থ ব্যবহারিক', 'নাসরিন আক্তার', 'ল্যাব ১',
               { isDouble: true, doubleGroupId: 'demo-dbl-1' }),
            mk('demo-slot-10', 1, 4, 'ইংরেজি', 'করিম উদ্দিন', '১০৩'),
            mk('demo-slot-11', 3, 4, 'রসায়ন', null, 'ল্যাব ২'),
            mk('demo-slot-12', 0, 5, 'বাংলা', 'সালমা খাতুন', '১০৩'),
          ],
        });
      }

      case '/api/v1/rms/substitute': {
        const req = JSON.parse(String(init.body ?? '{}')) as { assign?: boolean };
        if (req.assign) return ok({ ok: true, substitutionId: 'demo-substitution-1' });
        return ok({
          ok: true,
          candidates: [
            { teacherId: 'demo-t1', fullName: { bn: 'রহিম উদ্দিন', en: 'Rahim Uddin' }, rank: 1, matchScore: 92, matchReasons: ['subject_expertise', 'load_today:2', 'subs_last_30d:0'] },
            { teacherId: 'demo-t2', fullName: { bn: 'সালমা খাতুন', en: 'Salma Khatun' }, rank: 2, matchScore: 71, matchReasons: ['no_subject_match', 'load_today:1', 'subs_last_30d:1'] },
            { teacherId: 'demo-t3', fullName: { bn: 'কামাল হোসেন', en: 'Kamal Hossain' }, rank: 3, matchScore: 55, matchReasons: ['no_subject_match', 'load_today:3', 'subs_last_30d:2'] },
          ],
        });
      }

      case '/api/v1/ai/sikhok':
        return ok({
          ok: true,
          taskType: 'generate_cq',
          grounded: false,
          content: DEMO_CQ,
          model: 'demo',
          usage: { inputTokens: 0, outputTokens: 0 },
        });

      case '/api/v1/ai/shikho': {
        const req = JSON.parse(String(init.body ?? '{}')) as { message?: string; classLevel?: number };
        // Demo alternates the two answer states on purpose. F-1302's whole
        // point is that a student can tell a textbook-grounded answer from
        // general knowledge, and a demo that only ever shows one of them
        // demonstrates neither. Question marks read as a curriculum lookup;
        // anything else falls through to the ungrounded state.
        const grounded = (req.message ?? '').includes('?') || (req.message ?? '').includes('？');
        return ok({
          ok: true,
          grounded,
          sources: grounded ? ['পদার্থবিজ্ঞান ৯ম-১০ম / অধ্যায় ৯ — তরঙ্গ ও শব্দ'] : [],
          reply:
            `ভালো প্রশ্ন! "${(req.message ?? '').slice(0, 40)}" নিয়ে ভাবা যাক। ` +
            'সরাসরি উত্তর না বলে একটা প্রশ্ন করি: এই সমস্যায় প্রথম ধাপে কোন সূত্রটা কাজে লাগতে পারে বলে মনে হয়? ' +
            '(ডেমো মোড — আসল টিউটর চালু হলে ধাপে ধাপে শেখাবে।)',
          model: 'demo',
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      }

      case '/api/v1/sync/push': {
        const req = JSON.parse(String(init.body ?? '{}')) as PushRequest;
        const res: PushResponse = {
          serverTime: new Date().toISOString(),
          results: (req.ops ?? []).map((op) => ({ opId: op.opId, status: 'applied', rowVersion: 1 })),
        };
        return ok(res);
      }

      // ── R-6 ────────────────────────────────────────────────────────
      // The role scoping is reproduced, not skipped. A demo where a
      // guardian's search returned the whole school would be teaching the
      // opposite of what the endpoint does, and §18's browser walk checks
      // exactly this: teacher → own sections, guardian → own children,
      // student → self.
      case '/api/v1/academics/students/search':
        return demoStudentSearch(url.searchParams);
      case '/api/v1/academics/students/history':
        return demoStudentHistory(url.searchParams);

      // ── R-5 ────────────────────────────────────────────────────────
      // The one demo endpoint that answers HTML rather than JSON, because
      // that is what the real one answers.
      //
      // It renders through the SAME builders and the SAME brandedDocumentSet
      // the server uses — a demo that mocked up a receipt with its own markup
      // would be showing a document the product cannot actually produce, and
      // would go stale the first time a template changed. What is faked here
      // is the data, not the renderer.
      //
      // Switching demo tenants (?tenant=b) switches the letterhead, the
      // colour and the head teacher's name, which is the whole feature made
      // visible without two servers. Both demo tenants leave watermarkUrl
      // and signatureUrl empty, so this preview also exercises the
      // degrade-don't-break path every day.
      case '/api/v1/ops/document':
        return demoDocument(url.searchParams);

      // ── UX sweep: screens that opened on "আনা যায়নি" (findings 45, 47, 63)
      case '/api/v1/rms/rooms':
        return demoRoomsHandler(init);

      case '/api/v1/ops/staff-attendance':
        return demoStaffAttendance(url, init);

      case '/api/v1/auth/sessions':
      case '/api/v1/auth/sessions/revoke':
      case '/api/v1/auth/sessions/revoke-others':
        return demoSessions(url, init, this.deviceId);

      case '/api/v1/ops/push':
        return demoPush(init);

      case '/api/v1/auth/activate':
        return demoActivate(init);

      default:
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }
}
