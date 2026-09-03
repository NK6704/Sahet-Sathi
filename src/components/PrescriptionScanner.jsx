import React, { useState, useRef } from 'react';
import { analyzePrescriptionImage } from '../api.js';
import { useAppState } from '@/state/store';
import { getT, isHindiLang } from '@/services/i18n';
import {
  Camera,
  Upload,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Building2,
  User,
  Calendar,
  Activity,
  FileCheck2,
  Pill,
  ArrowRight,
  ShieldCheck,
  Stethoscope,
  Info,
  Award
} from 'lucide-react';
import { Link } from 'wouter';

export default function PrescriptionScanner({ language: propLanguage }) {
  const { language: globalLanguage } = useAppState();
  const activeLang = propLanguage || globalLanguage || 'Hindi';
  const t = getT(activeLang);
  const isHindi = isHindiLang(activeLang);

  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.onlyImageError);
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result);
      setResult(null);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!image) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const data = await analyzePrescriptionImage(image, 'image/jpeg', '', activeLang);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError(t.analysisFailed);
    } finally {
      setLoading(false);
    }
  };

  const isLowConfidence = result?.confidence === 'low' || result?.confidence === 'none';
  const hasUnclearMeds = result?.medicines?.some(m => 
    String(m.name).toLowerCase().includes('unclear')
  );

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-xl border border-emerald-100 overflow-hidden appear">
      {/* Top Header */}
      <div className="bg-gradient-to-r from-seal to-seal text-paper-2 p-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
            <Stethoscope size={24} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl">
              {t.scannerTitle}
            </h2>
            <p className="text-xs text-emerald-100 mt-0.5">
              {t.scannerSubtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {/* Image Upload Box */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
            image 
              ? 'border-emerald-300 bg-emerald-50/40' 
              : 'border-gray-300 bg-gray-50/60 hover:border-seal hover:bg-emerald-50/20'
          }`}
        >
          {image ? (
            <div className="relative group">
              <img 
                src={image} 
                alt="Prescription preview" 
                className="max-h-64 mx-auto rounded-xl object-contain shadow-sm border border-gray-200" 
              />
              <p className="mt-2 text-xs font-semibold text-seal underline">
                {t.changePhoto}
              </p>
            </div>
          ) : (
            <div className="text-gray-500 flex flex-col items-center gap-3 py-4">
              <div className="h-14 w-14 rounded-2xl bg-seal-soft text-seal flex items-center justify-center shadow-xs">
                <Camera size={28} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">
                  {t.uploadBoxTitle}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {t.uploadBoxSubtitle}
                </p>
              </div>
            </div>
          )}
          <input 
            ref={fileInputRef}
            type="file" 
            accept="image/*" 
            capture="environment"
            className="hidden" 
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {/* Action Button */}
        {image && (
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full bg-seal text-paper-2 py-3.5 rounded-2xl font-bold hover:bg-seal active:scale-[0.99] disabled:opacity-50 transition shadow-md flex items-center justify-center gap-2.5 text-sm"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            <span>
              {loading ? t.analyzingState : t.analyzeButton}
            </span>
          </button>
        )}

        {error && (
          <div className="bg-red-50 text-red-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 border border-red-200">
            <AlertTriangle size={18} className="shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Structured Results Display */}
        {result && (
          <div className="space-y-4 pt-2 appear">
            {/* Confidence & Document Info Banner */}
            <div className={`rounded-2xl p-4 border ${isLowConfidence ? 'bg-amber-50/80 border-amber-200' : 'bg-emerald-50/80 border-emerald-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-gray-200/60">
                <div className="flex items-center gap-1.5">
                  {isLowConfidence ? (
                    <AlertTriangle className="text-amber-600 shrink-0" size={18} />
                  ) : (
                    <CheckCircle className="text-emerald-600 shrink-0" size={18} />
                  )}
                  <span className="text-xs font-extrabold uppercase tracking-wide text-gray-800">
                    {result.detected_document_type || (isHindi ? 'डॉक्टर ओपीडी पर्ची' : 'OPD Prescription')}
                  </span>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${isLowConfidence ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}`}>
                  {t.confidence}: {result.confidence?.toUpperCase() || 'HIGH'}
                </span>
              </div>

              {/* Hospital & Doctor Metadata if identified */}
              {result.patient_info && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 text-xs text-gray-700">
                  {result.patient_info.hospital && (
                    <div className="flex items-center gap-1.5">
                      <Building2 size={14} className="text-seal shrink-0" />
                      <span className="font-semibold">{result.patient_info.hospital}</span>
                    </div>
                  )}
                  {result.patient_info.doctor && (
                    <div className="flex items-center gap-1.5">
                      <User size={14} className="text-seal shrink-0" />
                      <span>{t.doctor}: <strong className="font-semibold">{result.patient_info.doctor}</strong></span>
                    </div>
                  )}
                  {result.patient_info.patient_name && (
                    <div className="flex items-center gap-1.5">
                      <User size={14} className="text-seal shrink-0" />
                      <span>{t.patient}: <strong className="font-semibold">{result.patient_info.patient_name}</strong></span>
                    </div>
                  )}
                  {result.patient_info.date && (
                    <div className="flex items-center gap-1.5">
                      <Calendar size={14} className="text-seal shrink-0" />
                      <span>{t.date}: {result.patient_info.date}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Diagnosis / Clinical Summary */}
            {result.diagnosis_summary && (
              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5 text-blue-950 mb-1">
                  <Info size={15} className="text-blue-700" />
                  <span>{t.doctorSummaryTitle}</span>
                </p>
                <p>{result.diagnosis_summary}</p>
              </div>
            )}

            {/* Ordered Diagnostic Investigations & Lab Tests */}
            {result.investigations?.length > 0 && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-indigo-950 flex items-center gap-1.5">
                    <Activity size={16} className="text-indigo-600" />
                    <span>{t.prescribedTestsTitle}</span>
                  </h3>
                  <span className="text-[11px] font-bold bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded-full">
                    {result.investigations.length} {t.testsCount}
                  </span>
                </div>

                <div className="space-y-2">
                  {result.investigations.map((test, idx) => (
                    <div key={idx} className="bg-white rounded-xl p-3 border border-indigo-100 shadow-2xs">
                      <p className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-1.5">
                        <span>🧪</span> {test.test_name}
                      </p>
                      {test.purpose && (
                        <p className="text-xs text-gray-600 mt-1">
                          🎯 <strong>{t.testPurpose}</strong> {test.purpose}
                        </p>
                      )}
                      {test.preparation && (
                        <p className="text-[11px] font-semibold text-amber-700 mt-0.5">
                          ⚠️ <strong>{t.testPreparation}</strong> {test.preparation}
                        </p>
                      )}
                      {test.facility_support && (
                        <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                          🏛️ <strong>{t.testAvailability}</strong> {test.facility_support}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prescribed Medicines (if any) */}
            {result.medicines?.length > 0 && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-emerald-950 flex items-center gap-1.5">
                    <Pill size={16} className="text-emerald-600" />
                    <span>{t.prescribedMedicinesTitle}</span>
                  </h3>
                  <span className="text-[11px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
                    {result.medicines.length} {t.medicinesCount}
                  </span>
                </div>

                <div className="space-y-2">
                  {result.medicines.map((med, idx) => (
                    <div key={idx} className="bg-white rounded-xl p-3.5 text-xs border border-emerald-100 shadow-2xs">
                      <p className="font-bold text-gray-900 text-sm">
                        💊 {med.name}
                        {String(med.name).toLowerCase().includes('unclear') && (
                          <span className="text-amber-600 text-xs ml-2 font-normal">({t.unclear})</span>
                        )}
                      </p>
                      {med.generic_equivalent && (
                        <div className="bg-emerald-50 text-emerald-800 font-semibold p-1.5 rounded-lg mt-1 text-[11px]">
                          🏷️ <strong>{t.genericJanAushadhi}</strong> {med.generic_equivalent}
                        </div>
                      )}
                      {med.dosage && (
                        <p className="text-gray-700 font-medium mt-1">
                          🕒 <strong>{t.dosage}</strong> {med.dosage}
                        </p>
                      )}
                      {med.purpose && (
                        <p className="text-gray-500 mt-0.5">
                          🎯 <strong>{t.purpose}</strong> {med.purpose}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Next Steps for Patient */}
            {result.next_steps?.length > 0 && (
              <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4 space-y-2">
                <h3 className="font-bold text-xs uppercase tracking-wider text-teal-900 flex items-center gap-1.5">
                  <FileCheck2 size={15} className="text-teal-700" />
                  <span>{t.nextStepsTitle}</span>
                </h3>
                <ul className="space-y-1.5 text-xs text-teal-950 font-medium">
                  {result.next_steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <ArrowRight size={13} className="text-teal-600 mt-0.5 shrink-0" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Precautions */}
            {result.precautions?.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-1.5 text-xs text-amber-900">
                <p className="font-bold flex items-center gap-1.5 text-amber-950">
                  <ShieldCheck size={15} className="text-amber-700" />
                  <span>{t.precautionsTitle}</span>
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  {result.precautions.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Scheme Suggestion */}
            {result.scheme_suggestion && (
              <div className="bg-blue-50 border border-blue-200 text-blue-950 text-xs p-3.5 rounded-2xl flex items-start gap-2">
                <Award size={18} className="text-seal-bright shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-blue-900 mb-0.5">
                    {t.schemeGuidanceTitle}
                  </p>
                  <p className="leading-relaxed">{result.scheme_suggestion}</p>
                </div>
              </div>
            )}

            {/* Safety Warning */}
            <div className={`text-xs p-3.5 rounded-2xl font-medium border ${hasUnclearMeds ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
                <span>{result.safety_warning || t.safetyWarningDefault}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
