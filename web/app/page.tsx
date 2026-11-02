import {redirect} from "next/navigation";

/** The clinician has one DICOM workplace, not two competing dashboards. */
export default function Home(){redirect("/viewer");}
