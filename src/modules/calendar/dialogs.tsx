import { useState } from "react";
import { Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ColorPicker, DateTimeInput, PillToggle, Textarea } from "@/components/ui/kit";
import type { ClassKind, DateKind, ImportantDate, Semester, Subject, TimetableSlot } from "@/core/db/schema";
import { addDaysKey, minutesToTime, timeToMinutes, todayKey } from "@/lib/dates";
import { PALETTE } from "@/lib/palette";
import { WEEKDAYS } from "@/modules/habits/streaks";
import {
  useAddException,
  useCopyDay,
  useDeleteDate,
  useDeleteSlot,
  useDeleteSubject,
  useSaveDate,
  useSaveSemester,
  useSaveSlot,
  useSaveSubject,
} from "./data";
import { DATE_KINDS, KIND_LABEL } from "./labels";

function Footer({ onCancel, onSave, saving, disabled, onDelete, saveLabel = "Save" }: {
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  disabled?: boolean;
  onDelete?: () => void;
  saveLabel?: string;
}) {
  return (
    <DialogFooter className={onDelete ? "sm:justify-between" : undefined}>
      {onDelete ? (
        <Button variant="danger-ghost" onClick={onDelete}>
          <Trash />
          Delete
        </Button>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSave} loading={saving} disabled={disabled}>
          {saveLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

// ---------------------------------------------------------------------------

export function SemesterDialog({ semester, open, onClose }: { semester: Semester | null; open: boolean; onClose: () => void }) {
  const save = useSaveSemester();
  const [name, setName] = useState(semester?.name ?? "");
  const [start, setStart] = useState(semester?.startDate ?? todayKey());
  const [end, setEnd] = useState(semester?.endDate ?? addDaysKey(todayKey(), 120));
  const [target, setTarget] = useState(String(semester?.target ?? 80));
  const [labs, setLabs] = useState(semester?.separateLabs ?? false);
  const [tutorials, setTutorials] = useState(semester?.separateTutorials ?? false);
  const [unmarked, setUnmarked] = useState<Semester["unmarkedDefault"]>(semester?.unmarkedDefault ?? "unmarked");
  const [reminder, setReminder] = useState(String(semester?.reminderMinutes ?? 10));
  const valid = name.trim() && start && end && end > start && Number(target) > 0 && Number(target) <= 100;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{semester ? "Semester settings" : "Start a semester"}</DialogTitle>
          {!semester ? <DialogDescription>Your timetable and attendance belong to a semester.</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="sem-name">
            <Input id="sem-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Semester 5" autoFocus={!semester} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="sem-start">
              <DateTimeInput id="sem-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends" htmlFor="sem-end" error={end && start && end <= start ? "Must be after the start" : null}>
              <DateTimeInput id="sem-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum attendance (%)" htmlFor="sem-target">
              <Input id="sem-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
            <Field label="Remind before class (min)" htmlFor="sem-remind">
              <Input id="sem-remind" inputMode="numeric" value={reminder} onChange={(e) => setReminder(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 rounded-xl bg-surface-muted p-4">
            <p className="text-[13px] font-medium">Counting</p>
            <label className="flex items-center justify-between gap-4 text-[14px]">
              Count labs separately
              <Switch checked={labs} onCheckedChange={setLabs} aria-label="Count labs separately" />
            </label>
            <label className="flex items-center justify-between gap-4 text-[14px]">
              Count tutorials separately
              <Switch checked={tutorials} onCheckedChange={setTutorials} aria-label="Count tutorials separately" />
            </label>
            <label className="flex items-center justify-between gap-4 text-[14px]">
              Treat unmarked past classes as attended
              <Switch checked={unmarked === "present"} onCheckedChange={(v) => setUnmarked(v ? "present" : "unmarked")} aria-label="Treat unmarked classes as attended" />
            </label>
          </div>
        </div>
        <Footer
          onCancel={onClose}
          saving={save.isPending}
          disabled={!valid}
          saveLabel={semester ? "Save" : "Create semester"}
          onSave={async () => {
            await save.mutateAsync({
              id: semester?.id,
              name: name.trim(),
              startDate: start,
              endDate: end,
              target: Number(target),
              separateLabs: labs,
              separateTutorials: tutorials,
              unmarkedDefault: unmarked,
              reminderMinutes: Math.max(0, Number(reminder) || 0),
            });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function SubjectDialog({
  subject,
  semester,
  open,
  onClose,
  defaultColor,
}: {
  subject: Subject | null;
  semester: Semester;
  open: boolean;
  onClose: () => void;
  defaultColor: string;
}) {
  const save = useSaveSubject();
  const remove = useDeleteSubject();
  const [name, setName] = useState(subject?.name ?? "");
  const [code, setCode] = useState(subject?.code ?? "");
  const [professor, setProfessor] = useState(subject?.professor ?? "");
  const [color, setColor] = useState(subject?.color ?? defaultColor);
  const [target, setTarget] = useState(subject?.target ? String(subject.target) : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{subject ? "Edit subject" : "New subject"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" htmlFor="sub-name" className="col-span-2">
              <Input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Data Structures" autoFocus={!subject} />
            </Field>
            <Field label="Code" htmlFor="sub-code">
              <Input id="sub-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CS201" />
            </Field>
          </div>
          <Field label="Professor" htmlFor="sub-prof">
            <Input id="sub-prof" value={professor} onChange={(e) => setProfessor(e.target.value)} />
          </Field>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Colour</span>
            <ColorPicker colors={PALETTE} value={color} onChange={setColor} />
          </div>
          <Field label="Minimum attendance (%)" htmlFor="sub-target" hint={`Leave empty to use the semester's ${semester.target}%.`}>
            <Input id="sub-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(semester.target)} />
          </Field>
        </div>
        <Footer
          onCancel={onClose}
          saving={save.isPending}
          disabled={!name.trim()}
          onDelete={
            subject
              ? async () => {
                  await remove.mutateAsync(subject.id);
                  onClose();
                }
              : undefined
          }
          onSave={async () => {
            await save.mutateAsync({
              id: subject?.id,
              semesterId: semester.id,
              name: name.trim(),
              code: code.trim() || null,
              professor: professor.trim() || null,
              color,
              target: target ? Number(target) : null,
            });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function SlotDialog({
  slot,
  defaults,
  subjects,
  semester,
  open,
  onClose,
}: {
  slot: TimetableSlot | null;
  defaults?: { weekday?: number; startMin?: number };
  subjects: Subject[];
  semester: Semester;
  open: boolean;
  onClose: () => void;
}) {
  const save = useSaveSlot();
  const remove = useDeleteSlot();
  const [subjectId, setSubjectId] = useState(slot?.subjectId ?? subjects[0]?.id ?? "");
  const [weekday, setWeekday] = useState(slot?.weekday ?? defaults?.weekday ?? 1);
  const [start, setStart] = useState(minutesToTime(slot?.startMin ?? defaults?.startMin ?? 540));
  const [end, setEnd] = useState(minutesToTime(slot?.endMin ?? (defaults?.startMin ?? 540) + 60));
  const [kind, setKind] = useState<ClassKind>(slot?.kind ?? "lecture");
  const [room, setRoom] = useState(slot?.room ?? "");
  const [parity, setParity] = useState<TimetableSlot["weekParity"]>(slot?.weekParity ?? "all");
  const valid = subjectId && start && end && timeToMinutes(end) > timeToMinutes(start);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{slot ? "Edit class" : "Add a weekly class"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Subject" htmlFor="slot-subject">
            <NativeSelect id="slot-subject" className="w-full" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Type</span>
            <Segmented
              label="Type"
              value={kind}
              onChange={setKind}
              options={(Object.keys(KIND_LABEL) as ClassKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Day</span>
            <PillToggle label="Day" value={[weekday]} onChange={(v) => v.length && setWeekday(v[v.length - 1])} options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="slot-start">
              <DateTimeInput id="slot-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends" htmlFor="slot-end">
              <DateTimeInput id="slot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room" htmlFor="slot-room">
              <Input id="slot-room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="LT-3" />
            </Field>
            <Field label="Weeks" htmlFor="slot-parity">
              <NativeSelect id="slot-parity" className="w-full" value={parity} onChange={(e) => setParity(e.target.value as TimetableSlot["weekParity"])}>
                <option value="all">Every week</option>
                <option value="odd">Odd weeks</option>
                <option value="even">Even weeks</option>
              </NativeSelect>
            </Field>
          </div>
        </div>
        <Footer
          onCancel={onClose}
          saving={save.isPending}
          disabled={!valid}
          onDelete={
            slot
              ? async () => {
                  await remove.mutateAsync(slot.id);
                  onClose();
                }
              : undefined
          }
          onSave={async () => {
            await save.mutateAsync({
              id: slot?.id,
              semesterId: semester.id,
              subjectId,
              weekday,
              startMin: timeToMinutes(start),
              endMin: timeToMinutes(end),
              kind,
              room: room.trim() || null,
              weekParity: parity,
            });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function ExtraClassDialog({ semester, subjects, open, onClose, defaultDate }: { semester: Semester; subjects: Subject[]; open: boolean; onClose: () => void; defaultDate?: string }) {
  const add = useAddException();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate ?? todayKey());
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [kind, setKind] = useState<ClassKind>("lecture");
  const [room, setRoom] = useState("");
  const valid = subjectId && date && timeToMinutes(end) > timeToMinutes(start);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule an extra class</DialogTitle>
          <DialogDescription>A one-off class, like a Saturday make-up lecture.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Subject" htmlFor="extra-subject">
            <NativeSelect id="extra-subject" className="w-full" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Segmented label="Type" value={kind} onChange={setKind} options={(Object.keys(KIND_LABEL) as ClassKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date" htmlFor="extra-date">
              <DateTimeInput id="extra-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Starts" htmlFor="extra-start">
              <DateTimeInput id="extra-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends" htmlFor="extra-end">
              <DateTimeInput id="extra-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Room" htmlFor="extra-room">
            <Input id="extra-room" value={room} onChange={(e) => setRoom(e.target.value)} />
          </Field>
        </div>
        <Footer
          onCancel={onClose}
          saving={add.isPending}
          disabled={!valid}
          saveLabel="Schedule"
          onSave={async () => {
            await add.mutateAsync({
              semesterId: semester.id,
              kind: "extra",
              date,
              subjectId,
              classKind: kind,
              startMin: timeToMinutes(start),
              endMin: timeToMinutes(end),
              room: room.trim() || null,
            });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function BreakDialog({ semester, open, onClose }: { semester: Semester; open: boolean; onClose: () => void }) {
  const add = useAddException();
  const [kind, setKind] = useState<"holiday" | "vacation">("holiday");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey());
  const [end, setEnd] = useState(addDaysKey(todayKey(), 7));
  const valid = title.trim() && date && (kind === "holiday" || end >= date);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a holiday or vacation</DialogTitle>
          <DialogDescription>No classes are scheduled on these days.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Segmented
            label="Kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: "holiday", label: "Holiday (one day)" },
              { value: "vacation", label: "Vacation (date range)" },
            ]}
          />
          <Field label="Name" htmlFor="break-title">
            <Input id="break-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "holiday" ? "Diwali" : "Winter break"} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === "holiday" ? "Date" : "From"} htmlFor="break-from">
              <DateTimeInput id="break-from" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {kind === "vacation" ? (
              <Field label="To" htmlFor="break-to">
                <DateTimeInput id="break-to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            ) : null}
          </div>
        </div>
        <Footer
          onCancel={onClose}
          saving={add.isPending}
          disabled={!valid}
          saveLabel="Add"
          onSave={async () => {
            await add.mutateAsync({ semesterId: semester.id, kind, date, endDate: kind === "vacation" ? end : null, title: title.trim() });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function CopyDayDialog({ semester, slots, open, onClose }: { semester: Semester; slots: TimetableSlot[]; open: boolean; onClose: () => void }) {
  const copy = useCopyDay();
  const days = [...new Set(slots.map((s) => s.weekday))].sort();
  const [from, setFrom] = useState(days[0] ?? 1);
  const [to, setTo] = useState<number[]>([]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy a day</DialogTitle>
          <DialogDescription>Copies every class on one day to other days.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Copy from</span>
            <PillToggle label="From" value={[from]} onChange={(v) => v.length && setFrom(v[v.length - 1])} options={days.map((d) => ({ value: d, label: WEEKDAYS[d - 1] }))} />
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">To</span>
            <PillToggle label="To" value={to} onChange={setTo} options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d })).filter((o) => o.value !== from)} />
          </div>
        </div>
        <Footer
          onCancel={onClose}
          saving={copy.isPending}
          disabled={!to.length}
          saveLabel="Copy"
          onSave={async () => {
            await copy.mutateAsync({ slots, from, to, semesterId: semester.id });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function DateDialog({ item, open, onClose }: { item: ImportantDate | null; open: boolean; onClose: () => void }) {
  const save = useSaveDate();
  const remove = useDeleteDate();
  const [title, setTitle] = useState(item?.title ?? "");
  const [kind, setKind] = useState<DateKind>(item?.kind ?? "birthday");
  const [date, setDate] = useState(item?.date ?? todayKey());
  const [recurrence, setRecurrence] = useState<ImportantDate["recurrence"]>(item?.recurrence ?? "yearly");
  const [offsets, setOffsets] = useState<number[]>(item?.remindOffsets ?? [0, 1]);
  const [notes, setNotes] = useState(item?.notes ?? "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit date" : "New important date"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="What" htmlFor="date-title">
            <Input id="date-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mom's birthday, DBMS endsem, passport renewal" autoFocus={!item} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor="date-kind">
              <NativeSelect
                id="date-kind"
                className="w-full"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as DateKind;
                  setKind(k);
                  setRecurrence(k === "birthday" || k === "anniversary" ? "yearly" : "none");
                }}
              >
                {DATE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Date" htmlFor="date-date" hint={kind === "birthday" ? "Include the birth year to see the age." : undefined}>
              <DateTimeInput id="date-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Repeats</span>
            <Segmented
              label="Repeats"
              value={recurrence}
              onChange={setRecurrence}
              options={[
                { value: "none", label: "Once" },
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Remind me</span>
            <PillToggle
              label="Remind me"
              value={offsets}
              onChange={setOffsets}
              options={[
                { value: 0, label: "On the day" },
                { value: 1, label: "1 day before" },
                { value: 3, label: "3 days before" },
                { value: 7, label: "1 week before" },
              ]}
            />
          </div>
          <Field label="Notes" htmlFor="date-notes">
            <Textarea id="date-notes" className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <Footer
          onCancel={onClose}
          saving={save.isPending}
          disabled={!title.trim() || !date}
          onDelete={
            item
              ? async () => {
                  await remove.mutateAsync(item.id);
                  onClose();
                }
              : undefined
          }
          onSave={async () => {
            await save.mutateAsync({ id: item?.id, title: title.trim(), kind, date, recurrence, remindOffsets: offsets.sort((a, b) => a - b), notes: notes.trim() || null });
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
